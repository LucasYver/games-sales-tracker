import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { VercelCronGuard } from './vercel-cron.guard';
import { RefreshService } from './refresh.service';

@Controller('cron')
@UseGuards(VercelCronGuard)
export class CronController {
  constructor(private readonly refresh: RefreshService) {}

  @Get('refresh-steam')
  @HttpCode(200)
  refreshSteam() {
    return this.refresh.refreshAllSteamApps();
  }

  @Get('poll-feeds')
  @HttpCode(200)
  pollFeeds() {
    return this.refresh.pollTrustedFeeds();
  }

  @Get('discover-games')
  @HttpCode(200)
  discoverGames() {
    return this.refresh.discoverNewGames();
  }
}
