import { IsIn, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export class GenerateBlogFormatDto {
  @IsIn(['SALES_NEWS', 'LAUNCH_REPORT', 'SALES_RANKING'])
  kind: 'SALES_NEWS' | 'LAUNCH_REPORT' | 'SALES_RANKING';

  @ValidateIf((o: GenerateBlogFormatDto) => o.kind === 'SALES_NEWS')
  @IsUUID()
  milestoneId?: string;

  @ValidateIf((o: GenerateBlogFormatDto) => o.kind === 'LAUNCH_REPORT')
  @IsUUID()
  gameId?: string;

  @ValidateIf((o: GenerateBlogFormatDto) => o.kind === 'SALES_RANKING')
  @IsIn(['publisher', 'franchise'])
  subjectType?: 'publisher' | 'franchise';

  @ValidateIf((o: GenerateBlogFormatDto) => o.kind === 'SALES_RANKING')
  @IsString()
  @MaxLength(120)
  subjectKey?: string;
}
