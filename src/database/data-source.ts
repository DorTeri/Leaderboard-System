import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { User } from '../users/entities/user.entity.js';
import { NODE_ENV_DEVELOPMENT } from '../common/constants.js';

config();

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'leaderboard',
  password: process.env.DB_PASSWORD || 'leaderboard_secret',
  database: process.env.DB_DATABASE || 'leaderboard',
  entities: [User],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === NODE_ENV_DEVELOPMENT,
});
