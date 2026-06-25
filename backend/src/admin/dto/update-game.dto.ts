import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { SalesSource } from '../../entities';

export class UpdateGameDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  releaseDate?: string | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsInt()
  @IsPositive()
  igdbId?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @IsPositive()
  calibratedMultiplier?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @IsPositive()
  calibratedPsMultiplier?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @IsPositive()
  calibratedXboxMultiplier?: number | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(SalesSource)
  calibrationSourcePc?: SalesSource | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(SalesSource)
  calibrationSourcePs?: SalesSource | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsEnum(SalesSource)
  calibrationSourceXbox?: SalesSource | null;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== '')
  @IsUUID()
  genreProfileId?: string | null;
}
