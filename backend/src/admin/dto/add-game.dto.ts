import { IsString, MinLength } from 'class-validator';

export class AddGameDto {
  @IsString()
  @MinLength(1)
  url!: string;
}
