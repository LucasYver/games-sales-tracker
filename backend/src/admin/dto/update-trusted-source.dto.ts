import { IsBoolean } from 'class-validator';

export class UpdateTrustedSourceDto {
  @IsBoolean()
  active: boolean;
}
