import { IsEnum, IsOptional } from 'class-validator';
import { LauncherProfile } from '../../entities';

export class UpdatePublisherDto {
  @IsOptional()
  @IsEnum(LauncherProfile)
  launcherProfile?: LauncherProfile;
}
