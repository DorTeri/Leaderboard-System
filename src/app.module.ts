import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  appConfig,
  databaseConfig,
  redisConfig,
  leaderboardConfig,
} from './config/app.config.js';
import { RedisModule } from './redis/redis.module.js';
import { UsersModule } from './users/users.module.js';
import { LeaderboardModule } from './leaderboard/leaderboard.module.js';
import { HealthModule } from './health/health.module.js';
import { User } from './users/entities/user.entity.js';
import { NODE_ENV_DEVELOPMENT } from './common/constants.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, databaseConfig, redisConfig, leaderboardConfig],
    }),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.database'),
        entities: [User],
        synchronize: false,
        logging: config.get<string>('app.nodeEnv') === NODE_ENV_DEVELOPMENT,
      }),
    }),

    RedisModule,
    UsersModule,
    LeaderboardModule,
    HealthModule,
  ],
})
export class AppModule {}
