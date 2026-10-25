import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import type { BlogLocale } from '../entities';
import { BlogService } from './blog.service';

const LOCALES = new Set<BlogLocale>(['en', 'fr']);

function parseLocale(raw: string | undefined): BlogLocale {
  return raw === 'fr' ? 'fr' : 'en';
}

@Controller('blog')
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @Get()
  list(
    @Query('locale') locale?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.blog.listPublic(
      parseLocale(locale),
      Number(limit) || undefined,
      Number(offset) || undefined,
    );
  }

  @Get('sitemap')
  sitemap() {
    return this.blog.listSitemap();
  }

  @Get(':locale/:slug')
  get(@Param('locale') locale: string, @Param('slug') slug: string) {
    if (!LOCALES.has(locale as BlogLocale)) {
      throw new NotFoundException(`Unknown locale ${locale}`);
    }
    return this.blog.getPublic(locale as BlogLocale, slug);
  }
}
