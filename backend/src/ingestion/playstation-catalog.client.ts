import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import {
  PLAYSTATION_COUNTRY_LOCALE,
  toStoredMinorUnits,
  type PlaystationStoreCountry,
} from './playstation-store-countries';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const GRAPHQL_URL = 'https://web.np.playstation.com/api/graphql/v1/op';

/** Persisted-query hash for `metGetPricingDataByConceptId`. Rotates with the storefront. */
const PRICING_BY_CONCEPT_HASH =
  'abcb311ea830e679fe2b697a27f755764535d825b24510ab1239a4ca3092bd09';

const CONCEPT_ID_RE = /\/concept\/(\d+)/i;

// Storefront GraphQL has no published budget; keep retries short and back off
// hard on 429 so parallel price polls don't amplify a throttle window.
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 1000;

export interface PlaystationCatalogPrice {
  currency: string;
  initial: number;
  final: number;
  discountPercent: number;
}

interface PricingJson {
  data?: {
    conceptRetrieve?: {
      defaultProduct?: {
        price?: {
          basePriceValue?: number;
          discountedValue?: number;
          currencyCode?: string;
        };
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

@Injectable()
export class PlaystationCatalogClient {
  private readonly logger = new Logger(PlaystationCatalogClient.name);

  conceptIdFromUrl(url: string): string | null {
    const match = url.split('?')[0].match(CONCEPT_ID_RE);
    return match?.[1] ?? null;
  }

  /**
   * One concept × country GraphQL call (no multi-id batch on this op).
   * Retries HTTP 429; other failures return null so the cron can skip.
   */
  async getPrice(
    conceptId: string,
    country: PlaystationStoreCountry,
  ): Promise<PlaystationCatalogPrice | null> {
    const locale = PLAYSTATION_COUNTRY_LOCALE[country];

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const { data } = await axios.get<PricingJson>(GRAPHQL_URL, {
          params: {
            operationName: 'metGetPricingDataByConceptId',
            variables: JSON.stringify({ conceptId }),
            extensions: JSON.stringify({
              persistedQuery: {
                version: 1,
                sha256Hash: PRICING_BY_CONCEPT_HASH,
              },
            }),
          },
          headers: {
            'User-Agent': USER_AGENT,
            Accept: 'application/json',
            'content-type': 'application/json',
            Origin: 'https://store.playstation.com',
            Referer: 'https://store.playstation.com/',
            'x-psn-store-locale-override': locale,
          },
          timeout: 20000,
        });

        if (data.errors?.length && !data.data?.conceptRetrieve) {
          this.logger.warn(
            `PS pricing GraphQL error for ${conceptId} ${country}: ${data.errors[0]?.message}`,
          );
          return null;
        }

        return this.parsePrice(data);
      } catch (error) {
        if (
          axios.isAxiosError(error) &&
          error.response?.status === 429 &&
          attempt < MAX_ATTEMPTS
        ) {
          const retryAfter = Number(error.response.headers?.['retry-after']);
          const backoffMs = Number.isFinite(retryAfter)
            ? retryAfter * 1000
            : RETRY_BASE_MS * attempt;
          this.logger.warn(
            `PS pricing 429 for ${conceptId} ${country} ` +
              `(attempt ${attempt}/${MAX_ATTEMPTS}); retrying in ${Math.round(backoffMs)}ms`,
          );
          await this.sleep(backoffMs);
          continue;
        }

        const detail = axios.isAxiosError(error)
          ? JSON.stringify(error.response?.data ?? error.message)
          : String(error);
        this.logger.warn(
          `PS pricing failed for ${conceptId} ${country}: ${detail}`,
        );
        return null;
      }
    }

    return null;
  }

  private parsePrice(data: PricingJson): PlaystationCatalogPrice | null {
    const raw = data.data?.conceptRetrieve?.defaultProduct?.price;
    const initial = Number(raw?.basePriceValue);
    const final = Number(raw?.discountedValue);
    const currency =
      typeof raw?.currencyCode === 'string' && raw.currencyCode
        ? raw.currencyCode.toUpperCase()
        : '';
    if (!Number.isFinite(initial) || !Number.isFinite(final) || !currency) {
      return null;
    }
    if (initial <= 0 && final <= 0) return null;

    const storedInitial = toStoredMinorUnits(initial, currency);
    const storedFinal = toStoredMinorUnits(final, currency);
    const discountPercent =
      storedInitial > 0 && storedFinal < storedInitial
        ? Math.round((1 - storedFinal / storedInitial) * 100)
        : 0;
    return {
      currency,
      initial: storedInitial,
      final: storedFinal,
      discountPercent,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
