import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from '../users.service.js';
import { UsersRepository } from '../users.repository.js';
import { RedisLeaderboardService } from '../../redis/redis-leaderboard.service.js';
import { RedisService } from '../../redis/redis.service.js';
import { User } from '../entities/user.entity.js';
import {
  DEFAULT_CACHE_INVALIDATION_LIMITS,
  topCacheKey,
} from '../../common/constants.js';

describe('UsersService', () => {
  let service: UsersService;
  let repository: {
    createUser: jest.Mock;
    updateScore: jest.Mock;
    findOneBy: jest.Mock;
  };
  let redisLeaderboard: { addUser: jest.Mock };
  let redisService: { del: jest.Mock };

  const makeUser = (overrides: Partial<User> = {}): User => ({
    id: '1',
    name: 'TestUser',
    imageUrl: null,
    score: '0',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(async () => {
    repository = {
      createUser: jest.fn(),
      updateScore: jest.fn(),
      findOneBy: jest.fn(),
    };
    redisLeaderboard = { addUser: jest.fn() };
    redisService = { del: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UsersRepository, useValue: repository },
        { provide: RedisLeaderboardService, useValue: redisLeaderboard },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('create', () => {
    it('should create user in DB and add to ZSET', async () => {
      const user = makeUser();
      repository.createUser.mockResolvedValue(user);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.create({ name: 'TestUser' });

      expect(result).toEqual(user);
      expect(repository.createUser).toHaveBeenCalledWith('TestUser', undefined, undefined);
      expect(redisLeaderboard.addUser).toHaveBeenCalledWith('1', 0);
    });

    it('should create user with initial score', async () => {
      const user = makeUser({ score: '100' });
      repository.createUser.mockResolvedValue(user);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.create({ name: 'TestUser', score: 100 });

      expect(result.score).toBe('100');
      expect(redisLeaderboard.addUser).toHaveBeenCalledWith('1', 100);
    });

    it('should create user with score 0 explicitly', async () => {
      const user = makeUser({ score: '0' });
      repository.createUser.mockResolvedValue(user);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.create({ name: 'TestUser', score: 0 });

      expect(result.score).toBe('0');
      expect(redisLeaderboard.addUser).toHaveBeenCalledWith('1', 0);
    });

    it('should create user with very large score', async () => {
      const user = makeUser({ score: '9999999999' });
      repository.createUser.mockResolvedValue(user);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.create({ name: 'BigScorer', score: 9999999999 });

      expect(result.score).toBe('9999999999');
      expect(redisLeaderboard.addUser).toHaveBeenCalledWith('1', 9999999999);
    });

    it('should create user with imageUrl', async () => {
      const user = makeUser({ imageUrl: 'https://example.com/img.png' });
      repository.createUser.mockResolvedValue(user);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.create({
        name: 'TestUser',
        imageUrl: 'https://example.com/img.png',
      });

      expect(result.imageUrl).toBe('https://example.com/img.png');
      expect(repository.createUser).toHaveBeenCalledWith(
        'TestUser',
        'https://example.com/img.png',
        undefined,
      );
    });

    it('should still return user if Redis ZADD fails', async () => {
      const user = makeUser();
      repository.createUser.mockResolvedValue(user);
      redisLeaderboard.addUser.mockRejectedValue(new Error('Redis down'));

      const result = await service.create({ name: 'TestUser' });
      expect(result).toEqual(user);
    });

    it('should still return user if cache invalidation fails', async () => {
      const user = makeUser();
      repository.createUser.mockResolvedValue(user);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockRejectedValue(new Error('Redis connection lost'));

      const result = await service.create({ name: 'TestUser' });
      expect(result).toEqual(user);
    });

    it('should invalidate top cache after create', async () => {
      const user = makeUser();
      repository.createUser.mockResolvedValue(user);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      await service.create({ name: 'TestUser' });

      expect(redisService.del).toHaveBeenCalledWith(
        ...DEFAULT_CACHE_INVALIDATION_LIMITS.map(topCacheKey),
      );
    });

    it('should handle user with very large id (10M+ range)', async () => {
      const user = makeUser({ id: '10000001' });
      repository.createUser.mockResolvedValue(user);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.create({ name: 'User10M' });

      expect(result.id).toBe('10000001');
      expect(redisLeaderboard.addUser).toHaveBeenCalledWith('10000001', 0);
    });
  });

  describe('updateScore', () => {
    it('should update DB and ZSET', async () => {
      const updated = makeUser({ score: '500' });
      repository.updateScore.mockResolvedValue(updated);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.updateScore('1', 500);

      expect(result.score).toBe('500');
      expect(redisLeaderboard.addUser).toHaveBeenCalledWith('1', 500);
    });

    it('should throw NotFoundException when user not found', async () => {
      repository.updateScore.mockResolvedValue(null);
      await expect(service.updateScore('999', 100)).rejects.toThrow(NotFoundException);
    });

    it('should invalidate top cache after score update', async () => {
      const updated = makeUser({ score: '500' });
      repository.updateScore.mockResolvedValue(updated);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      await service.updateScore('1', 500);

      expect(redisService.del).toHaveBeenCalledWith(
        ...DEFAULT_CACHE_INVALIDATION_LIMITS.map(topCacheKey),
      );
    });

    it('should update score to 0', async () => {
      const updated = makeUser({ score: '0' });
      repository.updateScore.mockResolvedValue(updated);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.updateScore('1', 0);

      expect(result.score).toBe('0');
      expect(redisLeaderboard.addUser).toHaveBeenCalledWith('1', 0);
    });

    it('should update to very large score', async () => {
      const bigScore = 999999999;
      const updated = makeUser({ score: String(bigScore) });
      repository.updateScore.mockResolvedValue(updated);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockResolvedValue(undefined);

      const result = await service.updateScore('1', bigScore);

      expect(result.score).toBe(String(bigScore));
    });

    it('should still return user if Redis ZADD fails after DB update', async () => {
      const updated = makeUser({ score: '500' });
      repository.updateScore.mockResolvedValue(updated);
      redisLeaderboard.addUser.mockRejectedValue(new Error('Redis down'));

      const result = await service.updateScore('1', 500);
      expect(result.score).toBe('500');
    });

    it('should still return user if cache invalidation fails after DB update', async () => {
      const updated = makeUser({ score: '500' });
      repository.updateScore.mockResolvedValue(updated);
      redisLeaderboard.addUser.mockResolvedValue(undefined);
      redisService.del.mockRejectedValue(new Error('Redis fail'));

      const result = await service.updateScore('1', 500);
      expect(result.score).toBe('500');
    });

    it('should throw NotFoundException for non-existent user id in 10M range', async () => {
      repository.updateScore.mockResolvedValue(null);
      await expect(service.updateScore('10000001', 100)).rejects.toThrow(NotFoundException);
    });

    it('should handle rapid successive updates to the same user', async () => {
      for (let i = 0; i < 100; i++) {
        const updated = makeUser({ score: String(i * 10) });
        repository.updateScore.mockResolvedValue(updated);
        redisLeaderboard.addUser.mockResolvedValue(undefined);
        redisService.del.mockResolvedValue(undefined);

        const result = await service.updateScore('1', i * 10);
        expect(result.score).toBe(String(i * 10));
      }

      expect(repository.updateScore).toHaveBeenCalledTimes(100);
      expect(redisLeaderboard.addUser).toHaveBeenCalledTimes(100);
    });
  });

  describe('findById', () => {
    it('should return user if found', async () => {
      const user = makeUser();
      repository.findOneBy.mockResolvedValue(user);
      const result = await service.findById('1');
      expect(result).toEqual(user);
    });

    it('should throw NotFoundException if not found', async () => {
      repository.findOneBy.mockResolvedValue(null);
      await expect(service.findById('999')).rejects.toThrow(NotFoundException);
    });

    it('should find user with large id', async () => {
      const user = makeUser({ id: '10000000' });
      repository.findOneBy.mockResolvedValue(user);
      const result = await service.findById('10000000');
      expect(result.id).toBe('10000000');
    });

    it('should return user with all fields populated', async () => {
      const user = makeUser({
        id: '42',
        name: 'FullUser',
        imageUrl: 'https://example.com/full.png',
        score: '12345',
      });
      repository.findOneBy.mockResolvedValue(user);

      const result = await service.findById('42');

      expect(result.name).toBe('FullUser');
      expect(result.imageUrl).toBe('https://example.com/full.png');
      expect(result.score).toBe('12345');
    });
  });
});
