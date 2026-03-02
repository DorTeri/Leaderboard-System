import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { UsersRepository } from './users.repository.js';
import { RedisLeaderboardService } from '../redis/redis-leaderboard.service.js';
import { RedisService } from '../redis/redis.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { User } from './entities/user.entity.js';
import { ErrorCode } from '../common/enums/error-code.enum.js';
import {
  DEFAULT_CACHE_INVALIDATION_LIMITS,
  topCacheKey,
} from '../common/constants.js';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly redisLeaderboard: RedisLeaderboardService,
    private readonly redisService: RedisService,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const user = await this.usersRepository.createUser(
      dto.name,
      dto.imageUrl,
      dto.score,
    );

    const score = parseInt(user.score, 10);

    try {
      await this.redisLeaderboard.addUser(user.id, score);
      await this.invalidateTopCache();
    } catch (err) {
      this.logger.error(
        `Failed to add user ${user.id} to ZSET: ${(err as Error).message}. Run redis:rebuild to repair.`,
      );
    }

    this.logger.log(`Created user id=${user.id} name="${user.name}" score=${user.score}`);
    return user;
  }

  async updateScore(id: string, score: number): Promise<User> {
    const user = await this.usersRepository.updateScore(id, score);
    if (!user) {
      throw new NotFoundException({
        message: `User with id ${id} not found`,
        errorCode: ErrorCode.USER_NOT_FOUND,
      });
    }

    try {
      await this.redisLeaderboard.addUser(user.id, score);
      await this.invalidateTopCache();
    } catch (err) {
      this.logger.error(
        `Failed to update ZSET for user ${id}: ${(err as Error).message}`,
      );
    }

    this.logger.log(`Updated user id=${id} score=${score}`);
    return user;
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findOneBy({ id });
    if (!user) {
      throw new NotFoundException({
        message: `User with id ${id} not found`,
        errorCode: ErrorCode.USER_NOT_FOUND,
      });
    }
    return user;
  }

  private async invalidateTopCache(): Promise<void> {
    try {
      const keys = DEFAULT_CACHE_INVALIDATION_LIMITS.map(topCacheKey);
      await this.redisService.del(...keys);
    } catch (err) {
      this.logger.error(
        `Failed to invalidate top cache: ${(err as Error).message}`,
      );
    }
  }
}
