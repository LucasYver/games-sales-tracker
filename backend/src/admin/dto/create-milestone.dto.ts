import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Platform, SalesSource } from '../../entities';

export class CreateMilestoneDto {
  @IsEnum(SalesSource)
  source: SalesSource;

  @IsInt()
  @IsPositive()
  units: number;

  // A milestone without a date cannot feed calibration, so it is required.
  @IsISO8601()
  reportedAt: string;

  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(1)
  publisher?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUrl()
  sourceUrl?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MinLength(1)
  note?: string | null;

  @IsOptional()
  @IsBoolean()
  isEngagement?: boolean;

  @IsOptional()
  @IsBoolean()
  isEstimate?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @Min(0)
  @Max(100)
  confidenceScore?: number | null;
}
