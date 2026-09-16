import { Controller, Get, HttpCode, UseGuards } from '@nestjs/common';
import { VercelCronGuard } from './vercel-cron.guard';
import { RefreshService } from './refresh.service';

@Controller('cron')
@UseGuards(VercelCronGuard)
export class CronController {
  constructor(private readonly refresh: RefreshService) {}

  @Get('steam-reviews')
  @HttpCode(200)
  steamReviews() {
    return this.refresh.pollAllSteamReviews();
  }

  @Get('steam-reviewer-playtime')
  @HttpCode(200)
  steamReviewerPlaytime() {
    return this.refresh.pollAllSteamReviewerPlaytime();
  }

  @Get('store-ratings')
  @HttpCode(200)
  storeRatings() {
    return this.refresh.captureStoreRatings();
  }

  @Get('achievements')
  @HttpCode(200)
  achievements() {
    return this.refresh.captureAchievements();
  }

  @Get('estimate-rebuild')
  @HttpCode(200)
  estimateRebuild() {
    return this.refresh.rebuildStaleEstimates();
  }

  @Get('milestone-harvest')
  @HttpCode(200)
  milestoneHarvest() {
    return this.refresh.harvestAllGameMilestones();
  }

  @Get('steam-ccu')
  @HttpCode(200)
  steamCcu() {
    return this.refresh.refreshAllCcu();
  }

  @Get('steam-prices')
  @HttpCode(200)
  steamPrices() {
    return this.refresh.captureSteamPrices();
  }

  @Get('xbox-prices')
  @HttpCode(200)
  xboxPrices() {
    return this.refresh.captureXboxPrices();
  }

  @Get('ps-prices')
  @HttpCode(200)
  psPrices() {
    return this.refresh.capturePlaystationPrices();
  }

  @Get('game-discovery')
  @HttpCode(200)
  gameDiscovery() {
    return this.refresh.discoverNewGames();
  }

  @Get('steam-followers')
  @HttpCode(200)
  steamFollowers() {
    return this.refresh.captureGamesPopularity();
  }

  @Get('twitch-viewers')
  @HttpCode(200)
  twitchViewers() {
    return this.refresh.captureTwitchViewers();
  }

  @Get('game-rank')
  @HttpCode(200)
  gameRank() {
    return this.refresh.recomputeHomegrownRank();
  }
}
