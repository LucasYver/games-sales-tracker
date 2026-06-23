import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class UpdateGenreDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  profileId?: string | null;
}
