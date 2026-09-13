import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  toMinorUnits,
  xboxCurrencyForCountry,
  type XboxStoreCountry,
} from './xbox-store-countries';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const CATALOG_URL = 'https://displaycatalog.mp.microsoft.com/v7.0/products';

export const XBOX_PRODUCT_ID_RE = /^[A-Z0-9]{12}$/i;

export interface XboxCatalogRating {
  ratingCount: number;
  averageRating: number | null;
}

export interface XboxCatalogPrice {
  currency: string;
  initial: number;
  final: number;
  discountPercent: number;
}

export interface XboxCatalogProduct {
  productId: string;
  title: string | null;
  rating: XboxCatalogRating | null;
  price: XboxCatalogPrice | null;
}

interface CatalogJson {
  Products?: CatalogProductJson[];
}

interface CatalogProductJson {
  ProductId?: string;
  LocalizedProperties?: Array<{ ProductTitle?: string }>;
  MarketProperties?: Array<{
    UsageData?: Array<{
      AggregateTimeSpan?: string;
      AverageRating?: number;
      RatingCount?: number;
    }>;
  }>;
  DisplaySkuAvailabilities?: Array<{
    Sku?: { SkuType?: string; RecurrencePolicy?: unknown };
    Availabilities?: Array<{
      Actions?: string[];
      DisplayRank?: number;
      OrderManagementData?: {
        Price?: {
          CurrencyCode?: string;
          ListPrice?: number;
          MSRP?: number;
        };
      };
    }>;
  }>;
}

@Injectable()
export class XboxCatalogClient {
  private readonly logger = new Logger(XboxCatalogClient.name);

  async getProducts(
    productIds: string[],
    market: string,
  ): Promise<Map<string, XboxCatalogProduct>> {
    const result = new Map<string, XboxCatalogProduct>();
    const ids = [
      ...new Set(
        productIds
          .map((id) => id.trim().toUpperCase())
          .filter((id) => XBOX_PRODUCT_ID_RE.test(id)),
      ),
    ];
    if (ids.length === 0) return result;

    const { data } = await axios.get<CatalogJson>(CATALOG_URL, {
      params: {
        bigIds: ids.join(','),
        market: market.toUpperCase(),
        languages: 'en-US',
        fieldsTemplate: 'Details',
      },
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      timeout: 20000,
    });

    for (const raw of data.Products ?? []) {
      const parsed = this.parseProduct(raw, market);
      if (parsed) result.set(parsed.productId, parsed);
    }
    return result;
  }

  xboxProductIdFromUrl(url: string): string | null {
    const last = url.split('?')[0].split('/').filter(Boolean).pop();
    if (!last || !XBOX_PRODUCT_ID_RE.test(last)) return null;
    return last.toUpperCase();
  }

  private parseProduct(
    raw: CatalogProductJson,
    market: string,
  ): XboxCatalogProduct | null {
    const productId = raw.ProductId?.toUpperCase();
    if (!productId || !XBOX_PRODUCT_ID_RE.test(productId)) return null;
    return {
      productId,
      title: raw.LocalizedProperties?.[0]?.ProductTitle ?? null,
      rating: this.parseRating(raw),
      price: this.parsePrice(raw, market),
    };
  }

  private parseRating(raw: CatalogProductJson): XboxCatalogRating | null {
    const usage = raw.MarketProperties?.[0]?.UsageData ?? [];
    const allTime = usage.find((u) => u.AggregateTimeSpan === 'AllTime');
    const count = Number(allTime?.RatingCount);
    if (!Number.isFinite(count) || count <= 0) return null;
    const avg = Number(allTime?.AverageRating);
    return {
      ratingCount: count,
      averageRating: Number.isFinite(avg) && avg > 0 ? avg : null,
    };
  }

  /**
   * One-shot purchase of the base SKU. Skip trials, consumables, and
   * subscription/Game Pass recurrences. Prefer a Full SKU, then the
   * lowest DisplayRank among remaining Purchase availabilities.
   */
  private parsePrice(
    raw: CatalogProductJson,
    market: string,
  ): XboxCatalogPrice | null {
    type Candidate = {
      skuType: string;
      rank: number;
      currency: string;
      list: number;
      msrp: number;
    };
    const candidates: Candidate[] = [];

    for (const entry of raw.DisplaySkuAvailabilities ?? []) {
      const skuType = entry.Sku?.SkuType ?? '';
      if (skuType === 'Trial' || skuType === 'Consumable') continue;
      if (entry.Sku?.RecurrencePolicy) continue;

      for (const avail of entry.Availabilities ?? []) {
        if (!(avail.Actions ?? []).includes('Purchase')) continue;
        const price = avail.OrderManagementData?.Price;
        const list = Number(price?.ListPrice);
        const msrp = Number(price?.MSRP);
        if (!Number.isFinite(list) && !Number.isFinite(msrp)) continue;
        const paid = Number.isFinite(list) && list > 0 ? list : msrp;
        if (!Number.isFinite(paid) || paid <= 0) continue;
        const currency =
          typeof price?.CurrencyCode === 'string' && price.CurrencyCode
            ? price.CurrencyCode.toUpperCase()
            : xboxCurrencyForCountry(
                market.toLowerCase() as XboxStoreCountry,
              );
        candidates.push({
          skuType,
          rank: Number.isFinite(avail.DisplayRank) ? avail.DisplayRank! : 999,
          currency,
          list: Number.isFinite(list) && list > 0 ? list : paid,
          msrp: Number.isFinite(msrp) && msrp > 0 ? msrp : paid,
        });
      }
    }
    if (candidates.length === 0) return null;

    candidates.sort((a, b) => {
      const fullDelta = Number(b.skuType === 'Full') - Number(a.skuType === 'Full');
      if (fullDelta !== 0) return fullDelta;
      return a.rank - b.rank;
    });
    const best = candidates[0];
    const initial = toMinorUnits(best.msrp, best.currency);
    const final = toMinorUnits(best.list, best.currency);
    const discountPercent =
      initial > 0 && final < initial
        ? Math.round((1 - final / initial) * 100)
        : 0;
    return {
      currency: best.currency,
      initial,
      final,
      discountPercent,
    };
  }
}
