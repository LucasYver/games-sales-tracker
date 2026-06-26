import { IsString, MinLength } from 'class-validator';

export class ImportReviewsCsvDto {
  @IsString()
  @MinLength(1)
  csv!: string;
}
