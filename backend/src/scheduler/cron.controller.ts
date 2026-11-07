import {
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  UseGuards,
} from '@nestjs/common';
import { VercelCronGuard } from './vercel-cron.guard';
import { RefreshService } from './refresh.service';
import { CRON_JOBS, isCronJobName } from './cron-jobs';

@Controller('cron')
@UseGuards(VercelCronGuard)
export class CronController {
  constructor(private readonly refresh: RefreshService) {}

  /** `GET /api/cron/<name>`, called by Vercel on the `vercel.json` schedule. */
  @Get(':name')
  @HttpCode(200)
  run(@Param('name') name: string) {
    if (!isCronJobName(name)) {
      throw new NotFoundException(`Unknown cron "${name}"`);
    }
    return CRON_JOBS[name](this.refresh);
  }
}
