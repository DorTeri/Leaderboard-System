import { Injectable } from '@nestjs/common';
import { DataSource, Repository, In } from 'typeorm';
import { User } from './entities/user.entity.js';

@Injectable()
export class UsersRepository extends Repository<User> {
  constructor(private readonly dataSource: DataSource) {
    super(User, dataSource.createEntityManager());
  }

  async createUser(
    name: string,
    imageUrl?: string,
    score?: number,
  ): Promise<User> {
    const user = this.create({
      name,
      imageUrl: imageUrl ?? null,
      score: score !== undefined ? String(score) : '0',
    });
    return this.save(user);
  }

  async updateScore(userId: string, newScore: number): Promise<User | null> {
    return this.manager.transaction(async (manager) => {
      const user = await manager.findOne(User, {
        where: { id: userId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!user) return null;

      user.score = String(newScore);
      return manager.save(user);
    });
  }

  async findByIds(ids: string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    return this.find({ where: { id: In(ids) } });
  }
}
