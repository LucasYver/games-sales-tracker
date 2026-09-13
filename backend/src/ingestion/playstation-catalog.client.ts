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

  async getPrice(
    conceptId: string,
    country: PlaystationStoreCountry,
  ): Promise<PlaystationCatalogPrice | null> {
    const locale = PLAYSTATION_COUNTRY_LOCALE[country];
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
}
