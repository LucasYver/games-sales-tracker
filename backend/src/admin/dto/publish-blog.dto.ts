import { IsBoolean, IsOptional } from 'class-validator';

export class PublishBlogDto {
  // Publish even with unverified numbers or fact-check errors left.
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
