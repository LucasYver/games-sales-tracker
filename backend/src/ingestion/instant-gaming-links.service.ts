import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Game, GameSource } from '../entities';
import { SourceType } from '../entities/enums';
import {
  indexProducts,
  InstantGamingProduct,
  parseProductSitemap,
  pickProduct,
  productUrl,
  titleKey,
} from './instant-gaming-match';

const SITEMAP_INDEX = 'https://www.instant-gaming.com/sitemap_ig.xml';
const PRODUCT_SITEMAP =
  /<loc>(https:\/\/www\.instant-gaming\.com\/sitemap_ig_products_en(?:_\d+)?\.xml)<\/loc>/g;
// The store lists about 23,000 products. Far fewer means a sitemap page
// failed or changed shape; syncing on it would delete good links.
const MIN_PRODUCTS = 10_000;
const FETCH_TIMEOUT_MS = 60_000;
const WRITE_CHUNK = 500;

export type InstantGamingSyncResult = {
  products: number;
  matched: number;
  added: number;
  updated: number;
  removed: number;
};

/**
 * Links catalog games to their Instant Gaming product page (affiliate links).
 * Reads the store's public sitemap, matches products by exact title (see
 * `instant-gaming-match.ts`) and keeps one `game_source` INSTANT_GAMING row
 * per matched game. Runs at the end of the daily discovery cron; the
 * `sync-instant-gaming-links` script runs the same pass by hand.
 */
@Injectable()
export class InstantGamingLinksService {
  private readonly logger = new Logger(InstantGamingLinksService.name);

  constructor(
    @InjectRepository(Game)
    private readonly games: Repository<Game>,
    @InjectRepository(GameSource)
    private readonly sources: Repository<GameSource>,
  ) {}

  async sync(): Promise<InstantGamingSyncResult> {
    const [products, games, existing] = await Promise.all([
      this.fetchProducts(),
      this.games.find({
        select: {
          id: true,
          name: true,
          platforms: true,
          isFree: true,
          releaseDate: true,
        },
      }),
      this.sources.find({ where: { source: SourceType.INSTANT_GAMING } }),
    ]);
    if (products.length < MIN_PRODUCTS) {
      throw new Error(
        `Instant Gaming sitemap lists only ${products.length} products; sync skipped.`,
      );
    }

    const index = indexProducts(products);
    const nameCounts = new Map<string, number>();
    for (const g of games) {
      const key = titleKey(g.name);
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }

    // Free games are left out: a key for a free game is a paid pack, not it.
    const wanted = new Map<string, InstantGamingProduct>();
    for (const game of games) {
      if (game.isFree) continue;
      const product = pickProduct(
        {
          name: game.name,
          platforms: game.platforms,
          releaseYear: game.releaseDate?.getUTCFullYear() ?? null,
        },
        index,
        nameCounts,
      );
      if (product) wanted.set(game.id, product);
    }

    const current = new Map(existing.map((s) => [s.gameId, s]));
    const toRemove = existing.filter((s) => {
      const product = wanted.get(s.gameId);
      return !product || String(product.id) !== s.externalId;
    });
    const toWrite: Partial<GameSource>[] = [];
    let added = 0;
    let moved = 0;
    let renamed = 0;
    for (const [gameId, product] of wanted) {
      const row = current.get(gameId);
      const url = productUrl(product);
      if (!row) added++;
      else if (row.externalId !== String(product.id)) moved++;
      else {
        // Same product: refresh the URL only when its slug changed.
        if (row.url !== url) {
          await this.sources.update(row.id, { url });
          renamed++;
        }
        continue;
      }
      toWrite.push({
        gameId,
        source: SourceType.INSTANT_GAMING,
        externalId: String(product.id),
        url,
      });
    }

    // Delete first: a product that moved from one game to another must free
    // its (source, externalId) slot before the insert.
    for (let i = 0; i < toRemove.length; i += WRITE_CHUNK) {
      await this.sources.delete({
        id: In(toRemove.slice(i, i + WRITE_CHUNK).map((s) => s.id)),
      });
    }
    for (let i = 0; i < toWrite.length; i += WRITE_CHUNK) {
      await this.sources.insert(toWrite.slice(i, i + WRITE_CHUNK));
    }

    const result: InstantGamingSyncResult = {
      products: products.length,
      matched: wanted.size,
      added,
      updated: moved + renamed,
      removed: toRemove.length - moved,
    };
    this.logger.log(
      `Instant Gaming links: ${result.matched} game(s) matched over ` +
        `${result.products} product(s); +${result.added} ~${result.updated} ` +
        `-${result.removed}.`,
    );
    return result;
  }

  private async fetchProducts(): Promise<InstantGamingProduct[]> {
    const index = await this.fetchText(SITEMAP_INDEX);
    const pages = [...index.matchAll(PRODUCT_SITEMAP)].map((m) => m[1]);
    if (pages.length === 0) {
      throw new Error('Instant Gaming sitemap index lists no product page.');
    }
    const xmls = await Promise.all(pages.map((url) => this.fetchText(url)));
    return xmls.flatMap(parseProductSitemap);
  }

  private async fetchText(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
    return res.text();
  }
}
