/**
 * Xbox / Microsoft Store market codes. Same ISO alpha-2 lowercase convention
 * as `price_snapshot.country` / Steam. Not every ISO country — markets the
 * Display Catalog actually prices.
 */
export const XBOX_STORE_COUNTRIES = [
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
  'za',
  'il',
  'sa',
  'ae',
  'kw',
  'qa',
] as const;

export type XboxStoreCountry = (typeof XBOX_STORE_COUNTRIES)[number];

export const DEFAULT_XBOX_PRICE_COUNTRY: XboxStoreCountry = 'us';

export const XBOX_COUNTRY_CURRENCY: Record<XboxStoreCountry, string> = {
  us: 'USD',
  ca: 'CAD',
  mx: 'MXN',
  br: 'BRL',
  ar: 'ARS',
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
  tr: 'TRY',
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
  za: 'ZAR',
  il: 'ILS',
  sa: 'SAR',
  ae: 'AED',
  kw: 'KWD',
  qa: 'QAR',
};

const COUNTRY_SET = new Set<string>(XBOX_STORE_COUNTRIES);

export function isXboxStoreCountry(
  value: string,
): value is XboxStoreCountry {
  return COUNTRY_SET.has(value);
}

export function xboxCurrencyForCountry(country: XboxStoreCountry): string {
  return XBOX_COUNTRY_CURRENCY[country];
}

/** Same convention as Steam `final_price_in_cents` / the public price UI (`/ 100`). */
export function toMinorUnits(amount: number, _currency: string): number {
  return Math.round(amount * 100);
}
