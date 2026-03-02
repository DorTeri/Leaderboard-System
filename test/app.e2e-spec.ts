import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import supertest from 'supertest';
import { AppModule } from '../src/app.module.js';
import { GlobalExceptionFilter } from '../src/common/filters/http-exception.filter.js';
import { DataSource } from 'typeorm';
import { RedisLeaderboardService } from '../src/redis/redis-leaderboard.service.js';

describe('Leaderboard System (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let redisLeaderboard: RedisLeaderboardService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: false },
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    await app.init();

    dataSource = app.get(DataSource);
    redisLeaderboard = app.get(RedisLeaderboardService);

    await dataSource.query('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');
    await redisLeaderboard.flush();
  });

  afterAll(async () => {
    await dataSource.query('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');
    await redisLeaderboard.flush();
    await app.close();
  });

  describe('POST /users', () => {
    it('should create a new user with default score 0', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/users')
        .send({ name: 'Alice', imageUrl: 'https://example.com/alice.png' })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Alice');
      expect(res.body.score).toBe('0');
    });

    it('should create a user with an initial score', async () => {
      const res = await supertest(app.getHttpServer())
        .post('/users')
        .send({ name: 'Bob', score: 500 })
        .expect(201);

      expect(res.body.score).toBe('500');
    });

    it('should reject invalid body (missing name)', async () => {
      await supertest(app.getHttpServer())
        .post('/users')
        .send({ imageUrl: 'https://example.com/bob.png' })
        .expect(400);
    });

    it('should reject extra properties', async () => {
      await supertest(app.getHttpServer())
        .post('/users')
        .send({ name: 'Eve', hackerField: true })
        .expect(400);
    });
  });

  describe('PATCH /users/:id/score', () => {
    let userId: string;

    beforeAll(async () => {
      const res = await supertest(app.getHttpServer())
        .post('/users')
        .send({ name: 'ScoreTestUser' })
        .expect(201);
      userId = res.body.id;
    });

    it('should update user score', async () => {
      const res = await supertest(app.getHttpServer())
        .patch(`/users/${userId}/score`)
        .send({ score: 500 })
        .expect(200);

      expect(res.body.score).toBe('500');
    });

    it('should reject negative score', async () => {
      await supertest(app.getHttpServer())
        .patch(`/users/${userId}/score`)
        .send({ score: -10 })
        .expect(400);
    });

    it('should reject non-integer score', async () => {
      await supertest(app.getHttpServer())
        .patch(`/users/${userId}/score`)
        .send({ score: 10.5 })
        .expect(400);
    });

    it('should return 404 for nonexistent user', async () => {
      await supertest(app.getHttpServer())
        .patch('/users/999999/score')
        .send({ score: 100 })
        .expect(404);
    });

    it('should handle concurrent score updates without errors', async () => {
      for (let batch = 0; batch < 5; batch++) {
        const promises = Array.from({ length: 2 }, (_, i) =>
          supertest(app.getHttpServer())
            .patch(`/users/${userId}/score`)
            .send({ score: 1000 + batch * 2 + i }),
        );
        const results = await Promise.all(promises);
        results.forEach((r) => expect(r.status).toBe(200));
      }
    });
  });

  describe('GET /leaderboard/top', () => {
    beforeAll(async () => {
      await dataSource.query('TRUNCATE TABLE "users" RESTART IDENTITY CASCADE');
      await redisLeaderboard.flush();

      const users = [
        { name: 'Player1', score: 1000 },
        { name: 'Player2', score: 2000 },
        { name: 'Player3', score: 3000 },
        { name: 'Player4', score: 2000 },
        { name: 'Player5', score: 5000 },
        { name: 'Player6', score: 4000 },
        { name: 'Player7', score: 500 },
        { name: 'Player8', score: 3000 },
        { name: 'Player9', score: 6000 },
        { name: 'Player10', score: 100 },
        { name: 'Player11', score: 5000 },
        { name: 'Player12', score: 7000 },
      ];

      for (const u of users) {
        await supertest(app.getHttpServer())
          .post('/users')
          .send({ name: u.name, score: u.score });
      }
    });

    it('should return top 5 in correct order', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/leaderboard/top?limit=5')
        .expect(200);

      expect(res.body.data).toHaveLength(5);
      expect(res.body.data[0].position).toBe(1);
      expect(res.body.data[0].user.name).toBe('Player12');
      expect(res.body.data[1].user.name).toBe('Player9');
      expect(res.body.data[2].user.name).toBe('Player5');
      expect(res.body.data[3].user.name).toBe('Player11');
      expect(res.body.data[4].user.name).toBe('Player6');
    });

    it('should include metadata with limitRequested and limitApplied', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/leaderboard/top?limit=5')
        .expect(200);

      expect(res.body.meta).toBeDefined();
      expect(res.body.meta.limitRequested).toBe(5);
      expect(res.body.meta.limitApplied).toBe(5);
      expect(res.body.meta.total).toBe(12);
    });

    it('should handle tie-breaking deterministically (score DESC, id ASC)', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/leaderboard/top?limit=12')
        .expect(200);

      res.body.data.forEach(
        (entry: { position: number }, i: number) =>
          expect(entry.position).toBe(i + 1),
      );

      const score5000 = res.body.data.filter(
        (e: { user: { score: string } }) => e.user.score === '5000',
      );
      expect(score5000).toHaveLength(2);
      expect(parseInt(score5000[0].user.id, 10)).toBeLessThan(
        parseInt(score5000[1].user.id, 10),
      );
    });

    it('should clamp limit to max 1000', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/leaderboard/top?limit=5000')
        .expect(200);

      expect(res.body.meta.limitApplied).toBe(1000);
      expect(res.body.data.length).toBeLessThanOrEqual(1000);
    });

    it('should default limit when not provided', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/leaderboard/top')
        .expect(200);

      expect(res.body.meta.limitApplied).toBe(100);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });

  describe('GET /leaderboard/user/:id', () => {
    it('should return user rank with neighbors', async () => {
      const topRes = await supertest(app.getHttpServer())
        .get('/leaderboard/top?limit=12')
        .expect(200);

      const player6 = topRes.body.data.find(
        (e: { user: { name: string } }) => e.user.name === 'Player6',
      );
      expect(player6).toBeDefined();
      const player6Id = player6.user.id;

      const res = await supertest(app.getHttpServer())
        .get(`/leaderboard/user/${player6Id}`)
        .expect(200);

      expect(res.body.position).toBe(5);
      expect(res.body.user.name).toBe('Player6');
      expect(res.body.neighbors.above.length).toBeGreaterThan(0);
      expect(res.body.neighbors.above.length).toBeLessThanOrEqual(5);
      expect(res.body.neighbors.below.length).toBeGreaterThan(0);
      expect(res.body.neighbors.below.length).toBeLessThanOrEqual(5);

      for (const neighbor of res.body.neighbors.above) {
        expect(neighbor.position).toBeLessThan(res.body.position);
      }
      for (const neighbor of res.body.neighbors.below) {
        expect(neighbor.position).toBeGreaterThan(res.body.position);
      }
    });

    it('should return 404 for nonexistent user', async () => {
      await supertest(app.getHttpServer())
        .get('/leaderboard/user/999999')
        .expect(404);
    });

    it('should handle user at rank 1 (no above neighbors)', async () => {
      const topRes = await supertest(app.getHttpServer())
        .get('/leaderboard/top?limit=1')
        .expect(200);

      const topUserId = topRes.body.data[0].user.id;

      const res = await supertest(app.getHttpServer())
        .get(`/leaderboard/user/${topUserId}`)
        .expect(200);

      expect(res.body.position).toBe(1);
      expect(res.body.neighbors.above).toHaveLength(0);
      expect(res.body.neighbors.below.length).toBeGreaterThan(0);
    });

    it('should handle user at last rank (no below neighbors)', async () => {
      const topRes = await supertest(app.getHttpServer())
        .get('/leaderboard/top?limit=100')
        .expect(200);

      const lastUser = topRes.body.data[topRes.body.data.length - 1];
      const lastUserId = lastUser.user.id;

      const res = await supertest(app.getHttpServer())
        .get(`/leaderboard/user/${lastUserId}`)
        .expect(200);

      expect(res.body.position).toBe(topRes.body.data.length);
      expect(res.body.neighbors.below).toHaveLength(0);
      expect(res.body.neighbors.above.length).toBeGreaterThan(0);
    });
  });

  describe('GET /health', () => {
    it('should return healthy status', async () => {
      const res = await supertest(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(res.body.status).toBe('ok');
      expect(res.body.info).toHaveProperty('database');
      expect(res.body.info).toHaveProperty('redis');
    });
  });
});
