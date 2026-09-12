/**
 * Steam storefront country codes (`cc` / GetItems `country_code`) that have
 * a distinct package price. Not every ISO country — only markets Steam
 * actually prices. Codes are stored lowercase in `price_snapshot.country`.
 *
 * AR and TR bill in USD after Steam dropped ARS/TRY regional currencies.
 */
export const STEAM_STORE_COUNTRIES = [
  'us',
  'ca',
  'mx',
  'br',
  'ar',
  'cl',
  'co',
  'pe',
  'uy',
  'cr',
  'gb',
  'fr',
  'de',
  'it',
  'es',
  'nl',
  'be',
  'at',
  'pt',
  'ie',
  'fi',
  'gr',
  'lu',
  'pl',
  'cz',
  'hu',
  'ro',
  'se',
  'no',
  'dk',
  'ch',
  'sk',
  'au',
  'nz',
  'ru',
  'ua',
  'kz',
  'tr',
  'in',
  'id',
  'my',
  'ph',
  'sg',
  'th',
  'vn',
  'tw',
  'hk',
  'kr',
  'jp',
  'cn',
  'za',
  'il',
  'sa',
  'ae',
  'kw',
  'qa',
] as const;

export type SteamStoreCountry = (typeof STEAM_STORE_COUNTRIES)[number];

export const DEFAULT_STEAM_PRICE_COUNTRY: SteamStoreCountry = 'us';

export const STEAM_COUNTRY_CURRENCY: Record<SteamStoreCountry, string> = {
  us: 'USD',
  ca: 'CAD',
  mx: 'MXN',
  br: 'BRL',
  ar: 'USD',
  cl: 'CLP',
  co: 'COP',
  pe: 'PEN',
  uy: 'UYU',
  cr: 'CRC',
  gb: 'GBP',
  fr: 'EUR',
  de: 'EUR',
  it: 'EUR',
  es: 'EUR',
  nl: 'EUR',
  be: 'EUR',
  at: 'EUR',
  pt: 'EUR',
  ie: 'EUR',
  fi: 'EUR',
  gr: 'EUR',
  lu: 'EUR',
  pl: 'PLN',
  cz: 'CZK',
  hu: 'HUF',
  ro: 'RON',
  se: 'SEK',
  no: 'NOK',
  dk: 'DKK',
  ch: 'CHF',
  sk: 'EUR',
  au: 'AUD',
  nz: 'NZD',
  ru: 'RUB',
  ua: 'UAH',
  kz: 'KZT',
  tr: 'USD',
  in: 'INR',
  id: 'IDR',
  my: 'MYR',
  ph: 'PHP',
  sg: 'SGD',
  th: 'THB',
  vn: 'VND',
  tw: 'TWD',
  hk: 'HKD',
  kr: 'KRW',
  jp: 'JPY',
  cn: 'CNY',
  za: 'ZAR',
  il: 'ILS',
  sa: 'SAR',
  ae: 'AED',
  kw: 'KWD',
  qa: 'QAR',
};

const COUNTRY_SET = new Set<string>(STEAM_STORE_COUNTRIES);

export function isSteamStoreCountry(
  value: string,
): value is SteamStoreCountry {
  return COUNTRY_SET.has(value);
}

export function normalizeSteamPriceCountry(
  value: string | undefined | null,
): SteamStoreCountry {
  if (!value) return DEFAULT_STEAM_PRICE_COUNTRY;
  const code = value.trim().toLowerCase();
  return isSteamStoreCountry(code) ? code : DEFAULT_STEAM_PRICE_COUNTRY;
}

export function currencyForCountry(country: SteamStoreCountry): string {
  return STEAM_COUNTRY_CURRENCY[country];
}
