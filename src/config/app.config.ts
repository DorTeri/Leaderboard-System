import { registerAs } from '@nestjs/config';
import { NODE_ENV_DEVELOPMENT } from '../common/constants.js';

export const appConfig = registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || NODE_ENV_DEVELOPMENT,
  port: parseInt(process.env.PORT ?? '3000', 10),
}));

export const databaseConfig = registerAs('database', () => ({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT ?? '5432', 10),
  username: process.env.DB_USERNAME || 'leaderboard',
  password: process.env.DB_PASSWORD || 'leaderboard_secret',
  database: process.env.DB_DATABASE || 'leaderboard',
}));

export const redisConfig = registerAs('redis', () => ({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
}));

export const leaderboardConfig = registerAs('leaderboard', () => ({
  zsetKey: process.env.LEADERBOARD_ZSET_KEY || 'leaderboard:zset',
  defaultLimit: parseInt(process.env.DEFAULT_TOP_LIMIT ?? '100', 10),
  maxLimit: parseInt(process.env.MAX_TOP_LIMIT ?? '1000', 10),
  topCacheTtl: parseInt(process.env.TOP_CACHE_TTL_SECONDS ?? '10', 10),
  neighborCount: parseInt(process.env.LEADERBOARD_NEIGHBOR_COUNT ?? '5', 10),
}));
