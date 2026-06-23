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
import { Platform, SalesSource } from '../entities';
import { IngestionService } from '../ingestion/ingestion.service';
import { PublishersService } from '../publishers/publishers.service';
import { AddGameDto } from './dto/add-game.dto';
import { UpdateGameDto } from './dto/update-game.dto';
import { UpdatePublisherDto } from './dto/update-publisher.dto';

@Controller('admin')
@UseGuards(AdminTokenGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly ingestion: IngestionService,
    private readonly publishers: PublishersService,
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
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listGames({
      q,
      platform,
      hasSales:
        hasSales === 'true' ? true : hasSales === 'false' ? false : undefined,
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

  @Post('games/:id/rebuild-estimates')
  @HttpCode(200)
  rebuildEstimateHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.rebuildEstimateHistory(id);
  }

  @Post('games/:id/import-ccu-history')
  @HttpCode(200)
  importCcuHistory(@Param('id', ParseUUIDPipe) id: string) {
    return this.ingestion.importSteamPeakCcuHistory(id);
  }

  @Get('sales-records')
  listSalesRecords(
    @Query('gameId') gameId?: string,
    @Query('source') source?: string,
    @Query('platform') platform?: string,
    @Query('undated') undated?: string,
    @Query('suspect') suspect?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listSalesRecords({
      gameId,
      source: source as SalesSource | undefined,
      platform: platform as Platform | undefined,
      undated: undated === 'true',
      suspect: suspect === 'true',
      offset: offset ? Number(offset) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Delete('sales-records/:id')
  @HttpCode(200)
  deleteSalesRecord(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.deleteSalesRecord(id);
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
}
