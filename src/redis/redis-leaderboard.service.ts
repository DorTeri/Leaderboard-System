import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from './redis.service.js';
import { toZsetMember, fromZsetMember } from '../common/utils/pad-id.util.js';

export interface ZsetEntry {
  userId: string;
  score: number;
}

@Injectable()
export class RedisLeaderboardService {
  private readonly logger = new Logger(RedisLeaderboardService.name);
  private readonly zsetKey: string;

  constructor(
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
  ) {
    this.zsetKey = this.configService.get<string>(
      'leaderboard.zsetKey',
      'leaderboard:zset',
    );
  }

  async addUser(userId: string, score: number): Promise<void> {
    const member = toZsetMember(userId);
    await this.redisService.getClient().zadd(this.zsetKey, score, member);
  }

  async removeUser(userId: string): Promise<void> {
    const member = toZsetMember(userId);
    await this.redisService.getClient().zrem(this.zsetKey, member);
  }

  async getRank(userId: string): Promise<number | null> {
    const member = toZsetMember(userId);
    const rank = await this.redisService.getClient().zrevrank(this.zsetKey, member);
    return rank;
  }

  async getTopN(limit: number): Promise<ZsetEntry[]> {
    return this.getRange(0, limit - 1);
  }

  async getRange(start: number, stop: number): Promise<ZsetEntry[]> {
    const results: string[] = await this.redisService
      .getClient()
      .zrevrange(this.zsetKey, Math.max(0, start), stop, 'WITHSCORES');
    return this.parseWithScores(results);
  }

  async getCount(): Promise<number> {
    return this.redisService.getClient().zcard(this.zsetKey);
  }

  async flush(): Promise<void> {
    await this.redisService.getClient().del(this.zsetKey);
  }

  async bulkAdd(entries: { userId: string; score: number }[]): Promise<void> {
    const client = this.redisService.getClient();
    const pipeline = client.pipeline();
    for (const entry of entries) {
      const member = toZsetMember(entry.userId);
      pipeline.zadd(this.zsetKey, entry.score, member);
    }
    await pipeline.exec();
  }

  private parseWithScores(results: string[]): ZsetEntry[] {
    const entries: ZsetEntry[] = [];
    for (let i = 0; i < results.length; i += 2) {
      entries.push({
        userId: fromZsetMember(results[i]),
        score: parseInt(results[i + 1], 10),
      });
    }
    return entries;
  }
}
