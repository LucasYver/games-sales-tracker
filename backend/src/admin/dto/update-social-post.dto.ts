import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSocialPostDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  xText?: string;
}
