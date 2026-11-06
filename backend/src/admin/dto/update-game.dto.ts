import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Platform } from '../../entities/enums';
import {
  MANUAL_GAME_FIELDS,
  type ManualGameField,
} from '../../games/manual-fields';

// GLOBAL is a milestone scope (an unsplit worldwide total), not a platform a
// game ships on.
const GAME_PLATFORMS = Object.values(Platform).filter(
  (p) => p !== Platform.GLOBAL,
);

// genres / categories / steamTags are TypeORM `simple-array` columns, stored
// comma-joined: a comma inside a value would split it in two.
const NO_COMMA = /^[^,]*$/;

// `null` (or an empty string for text) clears a nullable column.
const nullable = () => ValidateIf((_, value) => value !== null);

export class UpdateGameDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  name?: string;

  @IsOptional()
  @nullable()
  @IsISO8601({ strict: true })
  releaseDate?: string | null;

  @IsOptional()
  @nullable()
  @IsInt()
  @IsPositive()
  igdbId?: number | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(5000)
  summary?: string | null;

  @IsOptional()
  @nullable()
  @ValidateIf((_, value) => value !== '')
  @IsUrl({ protocols: ['https', 'http'], require_protocol: true })
  @MaxLength(1000)
  coverUrl?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(300)
  developer?: string | null;

  @IsOptional()
  @nullable()
  @IsString()
  @MaxLength(300)
  publisher?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsIn(GAME_PLATFORMS, { each: true })
  platforms?: Platform[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Matches(NO_COMMA, {
    each: true,
    message: 'list values cannot contain a comma',
  })
  genres?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Matches(NO_COMMA, {
    each: true,
    message: 'list values cannot contain a comma',
  })
  categories?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  @Matches(NO_COMMA, {
    each: true,
    message: 'list values cannot contain a comma',
  })
  steamTags?: string[];

  @IsOptional()
  @IsBoolean()
  isFree?: boolean;

  @IsOptional()
  @IsBoolean()
  liveService?: boolean;

  // Columns to hand back to the crons: the lock is removed and the next
  // ingestion pass rewrites the value from Steam / IGDB.
  @IsOptional()
  @IsArray()
  @IsIn(MANUAL_GAME_FIELDS, { each: true })
  unlock?: ManualGameField[];
}
