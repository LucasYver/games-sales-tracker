import { IsNumber, IsOptional, Max, Min } from 'class-validator';

export class UpdatePublisherDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  steamSharePctLow?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  steamSharePctHigh?: number;
}
