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

export class UpdateMilestoneDto {
  @IsOptional()
  @IsEnum(SalesSource)
  source?: SalesSource;

  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;

  @IsOptional()
  @IsInt()
  @IsPositive()
  units?: number;

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
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  reportedAt?: string | null;

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
