import { Test, TestingModule } from '@nestjs/testing';
import {
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LeaderboardService } from '../leaderboard.service.js';
import { RedisLeaderboardService } from '../../redis/redis-leaderboard.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { UsersRepository } from '../../users/users.repository.js';
import { UsersService } from '../../users/users.service.js';
import { User } from '../../users/entities/user.entity.js';
import { topCacheKey } from '../../common/constants.js';

describe('LeaderboardService', () => {
  let service: LeaderboardService;
  let redisLeaderboard: {
    getTopN: jest.Mock;
    getRange: jest.Mock;
    getRank: jest.Mock;
    getCount: jest.Mock;
    addUser: jest.Mock;
  };
  let redisService: { get: jest.Mock; set: jest.Mock; del: jest.Mock };
  let usersRepository: { findByIds: jest.Mock };
  let usersService: { findById: jest.Mock };

  const makeUser = (id: string, name: string, score: string): User => ({
    id,
    name,
    imageUrl: null,
    score,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(async () => {
    redisLeaderboard = {
      getTopN: jest.fn(),
      getRange: jest.fn(),
      getRank: jest.fn(),
      getCount: jest.fn(),
      addUser: jest.fn(),
    };
    redisService = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
    usersRepository = { findByIds: jest.fn() };
    usersService = { findById: jest.fn() };

    const configService = {
      get: jest.fn((key: string, defaultValue: unknown) => {
        const map: Record<string, unknown> = {
          'leaderboard.defaultLimit': 100,
          'leaderboard.maxLimit': 1000,
          'leaderboard.topCacheTtl': 10,
          'leaderboard.neighborCount': 5,
        };
        return map[key] ?? defaultValue;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        { provide: RedisLeaderboardService, useValue: redisLeaderboard },
        { provide: RedisService, useValue: redisService },
        { provide: UsersRepository, useValue: usersRepository },
        { provide: UsersService, useValue: usersService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
  });

  describe('getTopN', () => {
    it('should return cached data on cache hit', async () => {
      const cached = {
        data: [],
        meta: { limitRequested: 10, limitApplied: 10, total: 0 },
      };
      redisService.get.mockResolvedValue(JSON.stringify(cached));

      const result = await service.getTopN(10);
      expect(result).toEqual(cached);
      expect(redisLeaderboard.getTopN).not.toHaveBeenCalled();
    });

    it('should query ZSET and hydrate from DB on cache miss', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([
        { userId: '1', score: 1000 },
        { userId: '2', score: 900 },
      ]);
      redisLeaderboard.getCount.mockResolvedValue(2);
      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'Alice', '1000'),
        makeUser('2', 'Bob', '900'),
      ]);

      const result = await service.getTopN(2);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].position).toBe(1);
      expect(result.data[0].user.name).toBe('Alice');
      expect(result.data[1].position).toBe(2);
      expect(result.data[1].user.name).toBe('Bob');
      expect(result.meta.total).toBe(2);
      expect(redisService.set).toHaveBeenCalled();
    });

    it('should clamp limit to max 1000', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([]);
      redisLeaderboard.getCount.mockResolvedValue(0);

      await service.getTopN(5000);
      expect(redisLeaderboard.getTopN).toHaveBeenCalledWith(1000);
    });

    it('should clamp limit to min 1', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([]);
      redisLeaderboard.getCount.mockResolvedValue(0);

      await service.getTopN(0);
      expect(redisLeaderboard.getTopN).toHaveBeenCalledWith(1);
    });

    it('should clamp negative limit to 1', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([]);
      redisLeaderboard.getCount.mockResolvedValue(0);

      await service.getTopN(-50);
      expect(redisLeaderboard.getTopN).toHaveBeenCalledWith(1);
    });

    it('should default limit to 100 when not specified', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([]);
      redisLeaderboard.getCount.mockResolvedValue(0);

      await service.getTopN(undefined);
      expect(redisLeaderboard.getTopN).toHaveBeenCalledWith(100);
    });

    it('should return empty data for empty leaderboard', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([]);
      redisLeaderboard.getCount.mockResolvedValue(0);

      const result = await service.getTopN(10);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('should include metadata with limitRequested undefined when not provided', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([]);
      redisLeaderboard.getCount.mockResolvedValue(0);

      const result = await service.getTopN(undefined);

      expect(result.meta.limitRequested).toBeUndefined();
      expect(result.meta.limitApplied).toBe(100);
    });

    it('should preserve Redis ordering when DB returns users out of order', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([
        { userId: '3', score: 500 },
        { userId: '1', score: 400 },
        { userId: '2', score: 300 },
      ]);
      redisLeaderboard.getCount.mockResolvedValue(3);
      usersRepository.findByIds.mockResolvedValue([
        makeUser('2', 'Bob', '300'),
        makeUser('1', 'Alice', '400'),
        makeUser('3', 'Charlie', '500'),
      ]);

      const result = await service.getTopN(3);

      expect(result.data[0].user.name).toBe('Charlie');
      expect(result.data[1].user.name).toBe('Alice');
      expect(result.data[2].user.name).toBe('Bob');
    });

    it('should handle tie scores — positions assigned by Redis ZSET order', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([
        { userId: '1', score: 1000 },
        { userId: '2', score: 1000 },
        { userId: '3', score: 1000 },
      ]);
      redisLeaderboard.getCount.mockResolvedValue(3);
      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'A', '1000'),
        makeUser('2', 'B', '1000'),
        makeUser('3', 'C', '1000'),
      ]);

      const result = await service.getTopN(3);

      expect(result.data[0].position).toBe(1);
      expect(result.data[0].user.id).toBe('1');
      expect(result.data[1].position).toBe(2);
      expect(result.data[1].user.id).toBe('2');
      expect(result.data[2].position).toBe(3);
      expect(result.data[2].user.id).toBe('3');
    });

    it('should skip users missing from DB and still assign correct positions', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([
        { userId: '1', score: 1000 },
        { userId: '999', score: 900 },
        { userId: '2', score: 800 },
      ]);
      redisLeaderboard.getCount.mockResolvedValue(3);
      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'Alice', '1000'),
        makeUser('2', 'Bob', '800'),
      ]);

      const result = await service.getTopN(3);

      expect(result.data).toHaveLength(2);
      expect(result.data[0].position).toBe(1);
      expect(result.data[0].user.name).toBe('Alice');
      expect(result.data[1].position).toBe(3);
      expect(result.data[1].user.name).toBe('Bob');
    });

    it('should use Redis score over DB score in response', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([
        { userId: '1', score: 1500 },
      ]);
      redisLeaderboard.getCount.mockResolvedValue(1);
      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'Alice', '1000'),
      ]);

      const result = await service.getTopN(1);

      expect(result.data[0].user.score).toBe('1500');
    });

    it('should handle large top N request (simulating 1000 entries)', async () => {
      redisService.get.mockResolvedValue(null);

      const zsetEntries = Array.from({ length: 1000 }, (_, i) => ({
        userId: String(i + 1),
        score: 100000 - i,
      }));
      const users = zsetEntries.map((e) =>
        makeUser(e.userId, `Player${e.userId}`, String(e.score)),
      );

      redisLeaderboard.getTopN.mockResolvedValue(zsetEntries);
      redisLeaderboard.getCount.mockResolvedValue(10_000_000);
      usersRepository.findByIds.mockResolvedValue(users);

      const result = await service.getTopN(1000);

      expect(result.data).toHaveLength(1000);
      expect(result.data[0].position).toBe(1);
      expect(result.data[999].position).toBe(1000);
      expect(result.meta.total).toBe(10_000_000);
    });

    it('should report total from ZSET even when returning fewer entries', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([
        { userId: '1', score: 100 },
      ]);
      redisLeaderboard.getCount.mockResolvedValue(10_000_000);
      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'Only', '100'),
      ]);

      const result = await service.getTopN(1);

      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(10_000_000);
    });

    it('should cache the response with correct TTL', async () => {
      redisService.get.mockResolvedValue(null);
      redisLeaderboard.getTopN.mockResolvedValue([
        { userId: '1', score: 100 },
      ]);
      redisLeaderboard.getCount.mockResolvedValue(1);
      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'Alice', '100'),
      ]);

      await service.getTopN(10);

      expect(redisService.set).toHaveBeenCalledWith(
        topCacheKey(10),
        expect.any(String),
        10,
      );
    });
  });

  describe('getUserLeaderboard', () => {
    it('should return rank with neighbors', async () => {
      const user = makeUser('5', 'Target', '500');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank.mockResolvedValue(4);

      redisLeaderboard.getRange.mockResolvedValue([
        { userId: '1', score: 900 },
        { userId: '2', score: 800 },
        { userId: '3', score: 700 },
        { userId: '4', score: 600 },
        { userId: '5', score: 500 },
        { userId: '6', score: 400 },
        { userId: '7', score: 300 },
      ]);

      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'U1', '900'),
        makeUser('2', 'U2', '800'),
        makeUser('3', 'U3', '700'),
        makeUser('4', 'U4', '600'),
        makeUser('5', 'Target', '500'),
        makeUser('6', 'U6', '400'),
        makeUser('7', 'U7', '300'),
      ]);

      const result = await service.getUserLeaderboard('5');

      expect(result.position).toBe(5);
      expect(result.user.name).toBe('Target');
      expect(result.neighbors.above).toHaveLength(4);
      expect(result.neighbors.below).toHaveLength(2);
      expect(result.neighbors.above[0].position).toBe(1);
      expect(result.neighbors.below[0].position).toBe(6);
    });

    it('should handle user at rank 1 — no above neighbors', async () => {
      const user = makeUser('1', 'TopPlayer', '10000');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank.mockResolvedValue(0);

      redisLeaderboard.getRange.mockResolvedValue([
        { userId: '1', score: 10000 },
        { userId: '2', score: 9000 },
        { userId: '3', score: 8000 },
        { userId: '4', score: 7000 },
        { userId: '5', score: 6000 },
        { userId: '6', score: 5000 },
      ]);

      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'TopPlayer', '10000'),
        makeUser('2', 'P2', '9000'),
        makeUser('3', 'P3', '8000'),
        makeUser('4', 'P4', '7000'),
        makeUser('5', 'P5', '6000'),
        makeUser('6', 'P6', '5000'),
      ]);

      const result = await service.getUserLeaderboard('1');

      expect(result.position).toBe(1);
      expect(result.neighbors.above).toHaveLength(0);
      expect(result.neighbors.below).toHaveLength(5);
      expect(result.neighbors.below[0].position).toBe(2);
    });

    it('should handle user at last rank — no below neighbors', async () => {
      const user = makeUser('10', 'LastPlayer', '10');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank.mockResolvedValue(9);

      redisLeaderboard.getRange.mockResolvedValue([
        { userId: '5', score: 60 },
        { userId: '6', score: 50 },
        { userId: '7', score: 40 },
        { userId: '8', score: 30 },
        { userId: '9', score: 20 },
        { userId: '10', score: 10 },
      ]);

      usersRepository.findByIds.mockResolvedValue([
        makeUser('5', 'P5', '60'),
        makeUser('6', 'P6', '50'),
        makeUser('7', 'P7', '40'),
        makeUser('8', 'P8', '30'),
        makeUser('9', 'P9', '20'),
        makeUser('10', 'LastPlayer', '10'),
      ]);

      const result = await service.getUserLeaderboard('10');

      expect(result.position).toBe(10);
      expect(result.neighbors.above).toHaveLength(5);
      expect(result.neighbors.below).toHaveLength(0);
      expect(result.neighbors.above[4].position).toBe(9);
    });

    it('should handle single-user leaderboard — no neighbors at all', async () => {
      const user = makeUser('1', 'OnlyPlayer', '100');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank.mockResolvedValue(0);

      redisLeaderboard.getRange.mockResolvedValue([
        { userId: '1', score: 100 },
      ]);

      usersRepository.findByIds.mockResolvedValue([user]);

      const result = await service.getUserLeaderboard('1');

      expect(result.position).toBe(1);
      expect(result.neighbors.above).toHaveLength(0);
      expect(result.neighbors.below).toHaveLength(0);
    });

    it('should handle tied scores — verify neighbor positions are sequential', async () => {
      const user = makeUser('3', 'Tied', '500');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank.mockResolvedValue(2);

      redisLeaderboard.getRange.mockResolvedValue([
        { userId: '1', score: 500 },
        { userId: '2', score: 500 },
        { userId: '3', score: 500 },
        { userId: '4', score: 500 },
        { userId: '5', score: 500 },
      ]);

      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'P1', '500'),
        makeUser('2', 'P2', '500'),
        makeUser('3', 'Tied', '500'),
        makeUser('4', 'P4', '500'),
        makeUser('5', 'P5', '500'),
      ]);

      const result = await service.getUserLeaderboard('3');

      expect(result.position).toBe(3);
      expect(result.neighbors.above).toHaveLength(2);
      expect(result.neighbors.below).toHaveLength(2);
      expect(result.neighbors.above[0].position).toBe(1);
      expect(result.neighbors.above[1].position).toBe(2);
      expect(result.neighbors.below[0].position).toBe(4);
      expect(result.neighbors.below[1].position).toBe(5);

      for (const entry of [
        ...result.neighbors.above,
        ...result.neighbors.below,
      ]) {
        expect(entry.user.score).toBe('500');
      }
    });

    it('should self-heal if user missing from ZSET', async () => {
      const user = makeUser('5', 'Target', '500');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(0);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisLeaderboard.getRange.mockResolvedValue([
        { userId: '5', score: 500 },
      ]);
      usersRepository.findByIds.mockResolvedValue([user]);

      const result = await service.getUserLeaderboard('5');
      expect(result.position).toBe(1);
      expect(redisLeaderboard.addUser).toHaveBeenCalledWith('5', 500);
    });

    it('should throw InternalServerErrorException if repair fails', async () => {
      const user = makeUser('5', 'Target', '500');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      redisLeaderboard.addUser.mockResolvedValue(undefined);

      await expect(service.getUserLeaderboard('5')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('should propagate NotFoundException for unknown user', async () => {
      usersService.findById.mockRejectedValue(
        new NotFoundException('User not found'),
      );
      await expect(service.getUserLeaderboard('999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should skip neighbors missing from DB gracefully', async () => {
      const user = makeUser('3', 'Target', '500');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank.mockResolvedValue(2);

      redisLeaderboard.getRange.mockResolvedValue([
        { userId: '1', score: 700 },
        { userId: '999', score: 600 },
        { userId: '3', score: 500 },
        { userId: '4', score: 400 },
      ]);

      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'P1', '700'),
        makeUser('3', 'Target', '500'),
        makeUser('4', 'P4', '400'),
      ]);

      const result = await service.getUserLeaderboard('3');

      expect(result.position).toBe(3);
      expect(result.neighbors.above).toHaveLength(1);
      expect(result.neighbors.above[0].user.id).toBe('1');
      expect(result.neighbors.above[0].position).toBe(1);
      expect(result.neighbors.below).toHaveLength(1);
      expect(result.neighbors.below[0].user.id).toBe('4');
      expect(result.neighbors.below[0].position).toBe(4);
    });

    it('should handle user at position in 10M range', async () => {
      const user = makeUser('5000000', 'MidPlayer', '50000');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank.mockResolvedValue(4999999);

      const rangeEntries: { userId: string; score: number }[] = [];
      const dbUsers: User[] = [];
      for (let i = -5; i <= 5; i++) {
        const id = String(5000000 + i);
        const score = 50000 - i;
        rangeEntries.push({ userId: id, score });
        dbUsers.push(makeUser(id, `P${id}`, String(score)));
      }

      redisLeaderboard.getRange.mockResolvedValue(rangeEntries);
      usersRepository.findByIds.mockResolvedValue(dbUsers);

      const result = await service.getUserLeaderboard('5000000');

      expect(result.position).toBe(5000000);
      expect(result.neighbors.above).toHaveLength(5);
      expect(result.neighbors.below).toHaveLength(5);
    });

    it('should use DB score for the target user (not Redis score)', async () => {
      const user = makeUser('1', 'Target', '999');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank.mockResolvedValue(0);
      redisLeaderboard.getRange.mockResolvedValue([
        { userId: '1', score: 888 },
      ]);
      usersRepository.findByIds.mockResolvedValue([user]);

      const result = await service.getUserLeaderboard('1');

      expect(result.user.score).toBe('999');
    });

    it('should use Redis scores for neighbor entries', async () => {
      const user = makeUser('2', 'Target', '500');
      usersService.findById.mockResolvedValue(user);
      redisLeaderboard.getRank.mockResolvedValue(1);

      redisLeaderboard.getRange.mockResolvedValue([
        { userId: '1', score: 9999 },
        { userId: '2', score: 500 },
        { userId: '3', score: 100 },
      ]);

      usersRepository.findByIds.mockResolvedValue([
        makeUser('1', 'P1', '1'),
        makeUser('2', 'Target', '500'),
        makeUser('3', 'P3', '3'),
      ]);

      const result = await service.getUserLeaderboard('2');

      expect(result.neighbors.above[0].user.score).toBe('9999');
      expect(result.neighbors.below[0].user.score).toBe('100');
    });
  });

  describe('invalidateTopCache', () => {
    it('should delete known cache keys', async () => {
      redisService.del.mockResolvedValue(undefined);

      await service.invalidateTopCache();

      expect(redisService.del).toHaveBeenCalledWith(
        topCacheKey(100),
        topCacheKey(1000),
      );
    });
  });
});
