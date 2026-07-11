import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';

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
}
