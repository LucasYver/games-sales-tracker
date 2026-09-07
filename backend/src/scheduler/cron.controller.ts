import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { VercelCronGuard } from './vercel-cron.guard';
import { RefreshService } from './refresh.service';

@Controller('cron')
@UseGuards(VercelCronGuard)
export class CronController {
  constructor(private readonly refresh: RefreshService) {}

  @Get('poll-reviews')
  @HttpCode(200)
  pollReviews() {
    return this.refresh.pollAllSteamReviews();
  }

  @Get('capture-store-ratings')
  @HttpCode(200)
  captureStoreRatings() {
    return this.refresh.captureStoreRatings();
  }

  @Get('capture-achievements')
  @HttpCode(200)
  captureAchievements() {
    return this.refresh.captureAchievements();
  }

  @Get('rebuild-estimates')
  @HttpCode(200)
  rebuildEstimates() {
    return this.refresh.rebuildStaleEstimates();
  }

  @Get('harvest-milestones')
  @HttpCode(200)
  harvestMilestones() {
    return this.refresh.harvestAllGameMilestones();
  }

  @Get('poll-ccu')
  @HttpCode(200)
  pollCcu() {
    return this.refresh.refreshAllCcu();
  }

  @Get('capture-prices')
  @HttpCode(200)
  capturePrices() {
    return this.refresh.captureSteamPrices();
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

  @Get('capture-popularity')
  @HttpCode(200)
  capturePopularity() {
    return this.refresh.captureGamesPopularity();
  }

  @Get('poll-twitch-viewers')
  @HttpCode(200)
  pollTwitchViewers() {
    return this.refresh.captureTwitchViewers();
  }

  @Get('recompute-rank')
  @HttpCode(200)
  recomputeRank() {
    return this.refresh.recomputeHomegrownRank();
  }
}
