import {
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { waitUntil } from '@vercel/functions';
import { AdminAuthGuard } from '../admin/admin-auth.guard';
import { RefreshService } from './refresh.service';
import { CRON_JOBS, isCronJobName, type CronJobName } from './cron-jobs';

export interface AdminCronJob {
  name: CronJobName;
  cronPath: string;
  /** True while this instance is running a manual start of the job. */
  running: boolean;
}

/**
 * Lets the back office start a scheduled job by hand. The job runs in the
 * background (kept alive by `waitUntil`, up to the function's maxDuration)
 * because a run can last up to `RefreshService.RUN_BUDGET_MS`, far longer
 * than the admin page should wait. Progress shows up in the dashboard's
 * ingestion state; the run's own summary goes to the logs.
 */
@Controller('admin/crons')
@UseGuards(AdminAuthGuard)
export class AdminCronController {
  private readonly logger = new Logger(AdminCronController.name);
  /** Best effort, per instance: blocks a double click, not a Vercel run. */
  private readonly running = new Set<CronJobName>();

  constructor(private readonly refresh: RefreshService) {}

  @Get()
  list(): AdminCronJob[] {
    return (Object.keys(CRON_JOBS) as CronJobName[]).map((name) => ({
      name,
      cronPath: `/api/cron/${name}`,
      running: this.running.has(name),
    }));
  }

  @Post(':name/run')
  @HttpCode(202)
  run(@Param('name') name: string): { name: CronJobName; startedAt: string } {
    if (!isCronJobName(name)) {
      throw new NotFoundException(`Unknown cron "${name}"`);
    }
    if (this.running.has(name)) {
      throw new ConflictException(`Cron "${name}" is already running`);
    }

    const startedAt = new Date();
    this.running.add(name);
    this.logger.log(`Manual run of ${name} started`);
    const job = CRON_JOBS[name](this.refresh)
      .then((result) => {
        const seconds = Math.round((Date.now() - startedAt.getTime()) / 1000);
        this.logger.log(
          `Manual run of ${name} finished in ${seconds}s: ${JSON.stringify(result ?? null).slice(0, 2000)}`,
        );
      })
      .catch((err: unknown) => {
        this.logger.error(
          `Manual run of ${name} failed: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err.stack : undefined,
        );
      })
      .finally(() => this.running.delete(name));
    // No-op outside Vercel, where the long-lived process finishes it anyway.
    waitUntil(job);

    return { name, startedAt: startedAt.toISOString() };
  }
}
