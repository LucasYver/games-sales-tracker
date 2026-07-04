import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminTokenGuard } from './admin-token.guard';
import { SalesSource } from '../entities';
import { IngestionService } from '../ingestion/ingestion.service';
import { PublishersService } from '../publishers/publishers.service';
import { GenresService } from '../genres/genres.service';
import { EstimationService } from '../estimation/estimation.service';
import { ReferenceProfilesAdminService } from '../reference-profiles/reference-profiles-admin.service';
import { RankService } from '../reference-profiles/rank.service';
import { AddGameDto } from './dto/add-game.dto';
import { ImportCcuCsvDto } from './dto/import-ccu-csv.dto';
import { ImportReviewsCsvDto } from './dto/import-reviews-csv.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { UpdateMilestoneDto } from './dto/update-milestone.dto';
import { UpdatePublisherDto } from './dto/update-publisher.dto';
@Controller('admin')
@UseGuards(AdminTokenGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly ingestion: IngestionService,
    private readonly publishers: PublishersService,
    private readonly genres: GenresService,
    private readonly estimation: EstimationService,
    private readonly referenceProfiles: ReferenceProfilesAdminService,
    private readonly rank: RankService,
  ) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('games')
  listGames(
    @Query('q') q?: string,
    @Query('platform') platform?: string,
    @Query('platformExclusive') platformExclusive?: string,
    @Query('hasSales') hasSales?: string,
    @Query('calibrated') calibrated?: string,
    @Query('hasEstimates') hasEstimates?: string,
    @Query('sort') sort?: string,
    @Query('direction') direction?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listGames({
      q,
      platform,
      platformExclusive: platformExclusive === 'true',
      hasSales:
        hasSales === 'true' ? true : hasSales === 'false' ? false : undefined,
      calibrated:
        calibrated === 'true'
          ? true
          : calibrated === 'false'
            ? false
            : undefined,
      hasEstimates:
        hasEstimates === 'true'
          ? true
          : hasEstimates === 'false'
            ? false
            : undefined,
      sort:
        sort === 'releaseDate' || sort === 'lastRefreshed' ? sort : undefined,
      direction: direction === 'asc' ? 'asc' : undefined,
      offset: offset ? Number(offset) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Post('games')
  @HttpCode(200)
  addGame(@Body() body: AddGameDto) {
    return this.ingestion.addGameFromIgdbUrl(body.url);
  }

  @Get('games/:id')
  getGame(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getGameDetail(id);
  }

  @Patch('games/:id')
  @HttpCode(200)
  updateGame(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateGameDto,
  ) {
    return this.admin.updateGame(id, body);
  }

  @Delete('games/:id')
  @HttpCode(200)
  deleteGame(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deleteGame(id);
  }

  @Post('games/:id/refresh')
  @HttpCode(200)
  refreshGame(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingestion.refreshGame(id);
  }

  @Post('games/:id/import-ccu-csv')
  @HttpCode(200)
  importCcuCsv(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ImportCcuCsvDto,
  ) {
    return this.ingestion.importCcuCsv(id, body.csv);
  }

  @Post('games/:id/import-reviews-csv')
  @HttpCode(200)
  importReviewsCsv(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ImportReviewsCsvDto,
  ) {
    return this.ingestion.importReviewsCsv(id, body.csv);
  }

  @Post('games/:id/backfill-reviews-histogram')
  @HttpCode(200)
  backfillReviewsHistogram(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingestion.backfillReviewsFromHistogram(id);
  }

  @Post('games/:id/backfill-ccu-steamcharts')
  @HttpCode(200)
  backfillCcuSteamCharts(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingestion.backfillCcuFromSteamCharts(id);
  }

  @Post('games/:id/backfill-followers')
  @HttpCode(200)
  backfillFollowers(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingestion.syncFollowersFromApi(id, { fullHistory: true });
  }

  @Post('games/:id/backfill-topseller-rank')
  @HttpCode(200)
  backfillTopSellerRank(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingestion.syncTopSellerRankFromApi(id, { fullHistory: true });
  }

  @Post('games/:id/rebuild')
  @HttpCode(200)
  rebuildEstimates(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.rebuildEstimates(id);
  }

  @Get('games/:id/estimate-breakdown')
  estimateBreakdown(@Param('id', ParseUUIDPipe) id: string) {
    return this.estimation.computeBreakdown(id);
  }

  @Get('milestones')
  listMilestones(
    @Query('gameId') gameId?: string,
    @Query('source') source?: string,
    @Query('undated') undated?: string,
    @Query('suspect') suspect?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listMilestones({
      gameId,
      source: source as SalesSource | undefined,
      undated: undated === 'true',
      suspect: suspect === 'true',
      offset: offset ? Number(offset) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch('milestones/:id')
  @HttpCode(200)
  updateMilestone(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMilestoneDto,
  ) {
    return this.admin.updateMilestone(id, body);
  }

  @Delete('milestones/:id')
  @HttpCode(200)
  deleteMilestone(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deleteMilestone(id);
  }

  @Delete('signals/:id')
  @HttpCode(200)
  deleteSignal(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deleteSignal(id);
  }

  @Get('trusted-sources')
  listTrustedSources() {
    return this.admin.listTrustedSources();
  }

  @Delete('trusted-sources/:id')
  @HttpCode(200)
  deleteTrustedSource(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deleteTrustedSource(id);
  }

  @Get('issues')
  issues() {
    return this.admin.issues();
  }

  @Get('publishers')
  listPublishers() {
    return this.publishers.list();
  }

  @Get('publishers/:id')
  getPublisher(@Param('id', ParseUUIDPipe) id: string) {
    return this.publishers.getDetail(id);
  }

  @Patch('publishers/:id')
  @HttpCode(200)
  updatePublisher(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdatePublisherDto,
  ) {
    return this.publishers.update(id, body);
  }

  @Post('publishers/backfill')
  @HttpCode(200)
  backfillPublisherLinks() {
    return this.publishers.backfillGameLinks();
  }

  @Get('ranks')
  listRanks() {
    return this.admin.listRanks();
  }

  @Post('ranks/recompute')
  @HttpCode(200)
  recomputeRanks() {
    return this.rank.recomputeAll();
  }

  @Get('reference-profiles')
  listReferenceProfiles() {
    return this.referenceProfiles.listAnchors();
  }

  @Get('reference-profiles/stats')
  referenceProfilesStats() {
    return this.referenceProfiles.corpusStats();
  }

  @Get('games/:id/matcher')
  inspectMatcher(@Param('id', ParseUUIDPipe) id: string) {
    return this.referenceProfiles.inspectGame(id);
  }

  @Get('genres')
  listGenres() {
    return this.genres.listGenres();
  }

  @Post('genres/sync-igdb')
  @HttpCode(200)
  syncGenresFromIgdb() {
    return this.genres.syncFromIgdb();
  }
}
