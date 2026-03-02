import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateScoreDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  score: number;
}
