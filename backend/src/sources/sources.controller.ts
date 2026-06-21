import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { SalesSource, SourceCategory } from '../entities';
import { SourcesService } from './sources.service';

class AddSourceDto {
  @IsString()
  slug: string;

  @IsString()
  name: string;

  @IsEnum(SourceCategory)
  category: SourceCategory;

  @IsEnum(SalesSource)
  salesSource: SalesSource;

  @IsOptional()
  @IsString()
  host?: string | null;

  @IsOptional()
  @IsString()
  handle?: string | null;

  @IsOptional()
  @IsString()
  url?: string | null;

  @IsOptional()
  @IsString()
  searchUrlTemplate?: string | null;

  @IsOptional()
  @IsString()
  feedUrl?: string | null;

  @IsOptional()
  @IsString()
  language?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  weight: number;
}

@Controller('sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  @Get()
  list(@Query('activeOnly') activeOnly?: string) {
    return this.sources.list(activeOnly === 'true');
  }

  @Post()
  add(@Body() body: AddSourceDto) {
    return this.sources.add({
      language: 'en',
      host: null,
      handle: null,
      url: null,
      searchUrlTemplate: null,
      feedUrl: null,
      ...body,
    });
  }
}
