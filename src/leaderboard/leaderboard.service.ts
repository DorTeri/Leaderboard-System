import {
  Injectable,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersRepository } from '../users/users.repository.js';
import { UsersService } from '../users/users.service.js';
import { RedisLeaderboardService, ZsetEntry } from '../redis/redis-leaderboard.service.js';
import { RedisService } from '../redis/redis.service.js';
import { User } from '../users/entities/user.entity.js';
import { clamp } from '../common/utils/clamp.util.js';
import {
  LeaderboardEntry,
  LeaderboardTopResponse,
  LeaderboardUserResponse,
  UserSummary,
} from './interfaces/leaderboard.interface.js';
import {
  DEFAULT_CACHE_INVALIDATION_LIMITS,
  topCacheKey,
} from '../common/constants.js';

@Injectable()
export class LeaderboardService {
  private readonly logger = new Logger(LeaderboardService.name);
  private readonly defaultLimit: number;
  private readonly maxLimit: number;
  private readonly topCacheTtl: number;
  private readonly neighborCount: number;

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly usersService: UsersService,
    private readonly redisLeaderboard: RedisLeaderboardService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.defaultLimit = this.configService.get<number>(
      'leaderboard.defaultLimit',
      100,
    );
    this.maxLimit = this.configService.get<number>(
      'leaderboard.maxLimit',
      1000,
    );
    this.topCacheTtl = this.configService.get<number>(
      'leaderboard.topCacheTtl',
      10,
    );
    this.neighborCount = this.configService.get<number>(
      'leaderboard.neighborCount',
      5,
    );
  }

  async getTopN(requestedLimit?: number): Promise<LeaderboardTopResponse> {
    const limit = clamp(requestedLimit ?? this.defaultLimit, 1, this.maxLimit);

    const cacheKey = topCacheKey(limit);
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache HIT for ${cacheKey}`);
      return JSON.parse(cached) as LeaderboardTopResponse;
    }

    this.logger.debug(`Cache MISS for ${cacheKey}`);

    const zsetEntries = await this.redisLeaderboard.getTopN(limit);
    const total = await this.redisLeaderboard.getCount();

    if (zsetEntries.length === 0) {
      return {
        data: [],
        meta: { limitRequested: requestedLimit, limitApplied: limit, total },
      };
    }

    const entries = await this.hydrateEntries(zsetEntries, 1);

    const response: LeaderboardTopResponse = {
      data: entries,
      meta: { limitRequested: requestedLimit, limitApplied: limit, total },
    };

    if (this.topCacheTtl > 0) {
      await this.redisService.set(
        cacheKey,
        JSON.stringify(response),
        this.topCacheTtl,
      );
    }

    return response;
  }

  async getUserLeaderboard(userId: string): Promise<LeaderboardUserResponse> {
    const user = await this.usersService.findById(userId);

    let rank = await this.redisLeaderboard.getRank(userId);

    if (rank === null) {
      this.logger.warn(`User ${userId} missing from ZSET, repairing...`);
      await this.redisLeaderboard.addUser(userId, parseInt(user.score, 10));
      rank = await this.redisLeaderboard.getRank(userId);
      if (rank === null) {
        throw new InternalServerErrorException(
          'Failed to determine rank after ZSET repair',
        );
      }
    }

    const position = rank + 1;

    const rangeStart = Math.max(0, rank - this.neighborCount);
    const rangeStop = rank + this.neighborCount;

    const rangeEntries = await this.redisLeaderboard.getRange(
      rangeStart,
      rangeStop,
    );

    const allIds = rangeEntries.map((e) => e.userId);
    const allUsers = await this.usersRepository.findByIds(allIds);
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const above: LeaderboardEntry[] = [];
    const below: LeaderboardEntry[] = [];
    let currentPosition = rangeStart + 1;

    for (const entry of rangeEntries) {
      const u = userMap.get(entry.userId);
      if (!u) {
        this.logger.warn(
          `User ${entry.userId} in ZSET but not in database — skipping`,
        );
        currentPosition++;
        continue;
      }

      if (currentPosition < position) {
        above.push({
          position: currentPosition,
          user: this.toUserSummary(u, entry.score),
        });
      } else if (currentPosition > position) {
        below.push({
          position: currentPosition,
          user: this.toUserSummary(u, entry.score),
        });
      }

      currentPosition++;
    }

    return {
      position,
      user: this.toUserSummary(user),
      neighbors: { above, below },
    };
  }

  async invalidateTopCache(): Promise<void> {
    const limits = [...DEFAULT_CACHE_INVALIDATION_LIMITS, this.defaultLimit];
    const unique = [...new Set(limits)].map(topCacheKey);
    await this.redisService.del(...unique);
    this.logger.debug('Top-N payload cache invalidated');
  }

  private async hydrateEntries(
    zsetEntries: ZsetEntry[],
    startPosition: number,
  ): Promise<LeaderboardEntry[]> {
    const ids = zsetEntries.map((e) => e.userId);
    const users = await this.usersRepository.findByIds(ids);
    const userMap = new Map(users.map((u) => [u.id, u]));

    const entries: LeaderboardEntry[] = [];
    let pos = startPosition;

    for (const entry of zsetEntries) {
      const user = userMap.get(entry.userId);
      if (!user) {
        this.logger.warn(
          `User ${entry.userId} in ZSET but not in database — skipping`,
        );
        pos++;
        continue;
      }
      entries.push({
        position: pos,
        user: this.toUserSummary(user, entry.score),
      });
      pos++;
    }

    return entries;
  }

  private toUserSummary(user: User, redisScore?: number): UserSummary {
    return {
      id: user.id,
      name: user.name,
      imageUrl: user.imageUrl,
      score: redisScore !== undefined ? String(redisScore) : user.score,
    };
  }
}
