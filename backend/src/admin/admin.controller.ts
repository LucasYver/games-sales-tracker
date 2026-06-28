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
import { AddGameDto } from './dto/add-game.dto';
import { ImportCcuCsvDto } from './dto/import-ccu-csv.dto';
import { ImportReviewsCsvDto } from './dto/import-reviews-csv.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { UpdatePublisherDto } from './dto/update-publisher.dto';
import { UpdateGenreProfileDto } from './dto/update-genre-profile.dto';
import { UpdateGenreDto } from './dto/update-genre.dto';

@Controller('admin')
@UseGuards(AdminTokenGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly ingestion: IngestionService,
    private readonly publishers: PublishersService,
    private readonly genres: GenresService,
    private readonly estimation: EstimationService,
  ) {}

  @Get('stats')
  stats() {
    return this.admin.stats();
  }

  @Get('games')
  listGames(
    @Query('q') q?: string,
    @Query('platform') platform?: string,
    @Query('hasSales') hasSales?: string,
    @Query('genreProfile') genreProfile?: string,
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
      hasSales:
        hasSales === 'true' ? true : hasSales === 'false' ? false : undefined,
      genreProfileId: genreProfile,
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

  @Post('games/:id/backfill-reviews')
  @HttpCode(200)
  backfillReviews(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingestion.backfillReviewsFromApi(id);
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

  @Post('backfill/igdb')
  startIgdbBackfill() {
    return this.ingestion.startIgdbBackfill();
  }

  @Get('backfill/igdb')
  igdbBackfillStatus() {
    return this.ingestion.getIgdbBackfillStatus();
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

  @Get('genre-profiles')
  listGenreProfiles() {
    return this.genres.listProfiles();
  }

  @Patch('genre-profiles/:id')
  @HttpCode(200)
  updateGenreProfile(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateGenreProfileDto,
  ) {
    return this.genres.updateProfile(id, body);
  }

  @Get('genres')
  listGenres() {
    return this.genres.listGenres();
  }

  @Patch('genres/:id')
  @HttpCode(200)
  updateGenre(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateGenreDto,
  ) {
    return this.genres.updateGenre(id, body);
  }

  @Post('genres/sync-igdb')
  @HttpCode(200)
  syncGenresFromIgdb() {
    return this.genres.syncFromIgdb();
  }
}
