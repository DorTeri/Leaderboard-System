import { Controller, Get, Param, Query, ParseIntPipe } from '@nestjs/common';
import { LeaderboardService } from './leaderboard.service.js';
import { LeaderboardQueryDto } from './dto/leaderboard-query.dto.js';
import {
  LeaderboardTopResponse,
  LeaderboardUserResponse,
} from './interfaces/leaderboard.interface.js';

@Controller('leaderboard')
export class LeaderboardController {
  constructor(private readonly leaderboardService: LeaderboardService) {}

  @Get('top')
  async getTop(
    @Query() query: LeaderboardQueryDto,
  ): Promise<LeaderboardTopResponse> {
    return this.leaderboardService.getTopN(query.limit);
  }

  @Get('user/:id')
  async getUserLeaderboard(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<LeaderboardUserResponse> {
    return this.leaderboardService.getUserLeaderboard(String(id));
  }
}
