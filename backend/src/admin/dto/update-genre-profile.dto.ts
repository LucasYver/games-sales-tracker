import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';
import { ConfidenceLevel, Year2Retention } from '../../entities';

export class UpdateGenreProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  pcShare?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  playstationShare?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  xboxShare?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  switchShare?: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  leanLabel?: string | null;

  @IsOptional()
  @IsEnum(ConfidenceLevel)
  confidence?: ConfidenceLevel;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  lifecycleIndex?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(20)
  firstWeekToYearOneMultiplier?: number;

  @IsOptional()
  @IsEnum(Year2Retention)
  year2Retention?: Year2Retention;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  lifecycleDriver?: string | null;
}
