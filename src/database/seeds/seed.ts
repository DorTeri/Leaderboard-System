import { config } from 'dotenv';
import Redis from 'ioredis';
import { User } from '../../users/entities/user.entity.js';
import { AppDataSource } from '../data-source.js';
import { toZsetMember } from '../../common/utils/pad-id.util.js';

config();

async function runSeed() {
  const dataSource = AppDataSource;
  await dataSource.initialize();

  const userRepository = dataSource.getRepository(User);
  const seedCount = parseInt(process.env.SEED_COUNT || '100', 10);
  const zsetKey = process.env.LEADERBOARD_ZSET_KEY || 'leaderboard:zset';

  console.log(`Seeding ${seedCount} users...`);

  const batchSize = 1000;
  const allUsers: User[] = [];

  for (let i = 0; i < seedCount; i += batchSize) {
    const batch: Partial<User>[] = [];
    const end = Math.min(i + batchSize, seedCount);
    for (let j = i; j < end; j++) {
      batch.push(
        userRepository.create({
          name: `Player${j + 1}`,
          imageUrl: `https://example.com/player${j + 1}.png`,
          score: String(Math.floor(Math.random() * 100000)),
        }),
      );
    }
    const saved = await userRepository.save(batch);
    allUsers.push(...saved);
    console.log(`  Inserted ${end} / ${seedCount} users into Postgres`);
  }

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  });

  console.log('Populating Redis ZSET...');
  await redis.del(zsetKey);

  for (let i = 0; i < allUsers.length; i += batchSize) {
    const batch = allUsers.slice(i, i + batchSize);
    const pipeline = redis.pipeline();
    for (const user of batch) {
      pipeline.zadd(zsetKey, parseInt(user.score, 10), toZsetMember(user.id));
    }
    await pipeline.exec();
    console.log(`  Added ${Math.min(i + batchSize, allUsers.length)} / ${allUsers.length} to ZSET`);
  }

  const count = await redis.zcard(zsetKey);
  console.log(`Done. ZSET has ${count} members.`);

  await redis.quit();
  await dataSource.destroy();
}

runSeed().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
