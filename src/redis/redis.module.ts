import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';
import { RedisLeaderboardService } from './redis-leaderboard.service.js';

@Global()
@Module({
  providers: [RedisService, RedisLeaderboardService],
  exports: [RedisService, RedisLeaderboardService],
})
export class RedisModule {}

