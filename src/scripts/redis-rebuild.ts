import { config } from 'dotenv';
import Redis from 'ioredis';
import { AppDataSource } from '../database/data-source.js';
import { User } from '../users/entities/user.entity.js';
import { toZsetMember } from '../common/utils/pad-id.util.js';

config();

const BATCH_SIZE = 10_000;

async function rebuild() {
  const zsetKey = process.env.LEADERBOARD_ZSET_KEY || 'leaderboard:zset';

  console.log('Initializing database connection...');
  await AppDataSource.initialize();

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  });

  console.log(`Flushing existing ZSET key: ${zsetKey}`);
  await redis.del(zsetKey);

  const userRepo = AppDataSource.getRepository(User);
  let lastId = '0';
  let total = 0;

  console.log(`Rebuilding ZSET in batches of ${BATCH_SIZE}...`);

  while (true) {
    const users = await userRepo
      .createQueryBuilder('user')
      .select(['user.id', 'user.score'])
      .where('user.id > :lastId', { lastId })
      .orderBy('user.id', 'ASC')
      .take(BATCH_SIZE)
      .getMany();

    if (users.length === 0) break;

    const pipeline = redis.pipeline();
    for (const user of users) {
      pipeline.zadd(zsetKey, parseInt(user.score, 10), toZsetMember(user.id));
    }
    await pipeline.exec();

    total += users.length;
    lastId = users[users.length - 1].id;
    console.log(`  Processed ${total} users...`);
  }

  const count = await redis.zcard(zsetKey);
  console.log(`\nRebuild complete. ZSET "${zsetKey}" has ${count} members.`);

  await redis.quit();
  await AppDataSource.destroy();
}

rebuild().catch((error) => {
  console.error('Rebuild failed:', error);
  process.exit(1);
});
