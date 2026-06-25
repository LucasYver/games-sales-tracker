import { IsString, MinLength } from 'class-validator';

export class ImportCcuCsvDto {
  @IsString()
  @MinLength(1)
  csv!: string;
}
