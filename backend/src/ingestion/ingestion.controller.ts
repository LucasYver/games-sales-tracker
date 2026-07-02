import { Body, Controller, Post } from '@nestjs/common';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  IsUUID,
} from 'class-validator';
import { Platform, SalesSource } from '../entities';
import { IngestionService } from './ingestion.service';

class AddSalesDto {
  @IsUUID()
  gameId: string;

  @IsInt()
  @IsPositive()
  units: number;

  @IsEnum(SalesSource)
  source: SalesSource;

  @IsOptional()
  @IsString()
  publisher?: string;

  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  reportedAt?: string;

  @IsOptional()
  @IsEnum(Platform)
  platform?: Platform;
}

class IngestArticleDto {
  @IsUrl()
  url: string;

  @IsUUID()
  gameId: string;
}

@Controller('ingestion')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post('steam')
  async ingestSteam(@Body('appId') appId: number) {
    const gameId = await this.ingestion.ingestSteamApp(Number(appId));
    return { gameId };
  }

  @Post('igdb')
  async importIgdb(@Body('query') query: string) {
    const count = await this.ingestion.importFromIgdb(query);
    return { imported: count };
  }

  @Post('sales')
  async addSales(@Body() body: AddSalesDto) {
    const milestone = await this.ingestion.addMilestone(body);
    return { id: milestone.id };
  }

  @Post('article')
  async ingestArticle(@Body() body: IngestArticleDto) {
    return this.ingestion.ingestArticle(body.url, body.gameId);
  }

  @Post('refresh')
  async refresh(@Body('gameId') gameId: string) {
    return this.ingestion.refreshGame(gameId);
  }

  @Post('poll-feeds')
  async pollFeeds() {
    return this.ingestion.pollFeeds();
  }

  @Post('discover-backlog')
  async discoverBacklog(@Body('gameId') gameId: string) {
    return this.ingestion.discoverBacklogByGameId(gameId);
  }

  @Post('discover-igdb')
  async discoverIgdb() {
    return this.ingestion.discoverIgdbGames();
  }
}
