/**
 * PlayStation Store market codes. Same ISO alpha-2 lowercase convention as
 * `price_snapshot.country` / Steam / Xbox. One PSN locale per country.
 */
export const PLAYSTATION_STORE_COUNTRIES = [
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

export type PlaystationStoreCountry =
  (typeof PLAYSTATION_STORE_COUNTRIES)[number];

export const PLAYSTATION_COUNTRY_LOCALE: Record<
  PlaystationStoreCountry,
  string
> = {
  us: 'en-us',
  ca: 'en-ca',
  mx: 'es-mx',
  br: 'pt-br',
  ar: 'es-ar',
  cl: 'es-cl',
  co: 'es-co',
  pe: 'es-pe',
  uy: 'es-uy',
  cr: 'es-cr',
  gb: 'en-gb',
  fr: 'fr-fr',
  de: 'de-de',
  it: 'it-it',
  es: 'es-es',
  nl: 'nl-nl',
  be: 'nl-be',
  at: 'de-at',
  pt: 'pt-pt',
  ie: 'en-ie',
  fi: 'fi-fi',
  gr: 'el-gr',
  pl: 'pl-pl',
  cz: 'cs-cz',
  hu: 'hu-hu',
  ro: 'ro-ro',
  se: 'sv-se',
  no: 'no-no',
  dk: 'da-dk',
  ch: 'de-ch',
  sk: 'sk-sk',
  au: 'en-au',
  nz: 'en-nz',
  ru: 'ru-ru',
  ua: 'uk-ua',
  tr: 'tr-tr',
  in: 'en-in',
  id: 'en-id',
  my: 'en-my',
  ph: 'en-ph',
  sg: 'en-sg',
  th: 'th-th',
  vn: 'en-vn',
  tw: 'zh-hant-tw',
  hk: 'zh-hant-hk',
  kr: 'ko-kr',
  jp: 'ja-jp',
  za: 'en-za',
  il: 'en-il',
  sa: 'en-sa',
  ae: 'en-ae',
  kw: 'en-kw',
  qa: 'en-qa',
};

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND']);

/**
 * Sony already returns USD/EUR in minor units. Zero-decimal currencies
 * are major units; scale them so the public UI `/ 100` matches Steam/Xbox.
 */
export function toStoredMinorUnits(
  amount: number,
  currency: string,
): number {
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    return Math.round(amount * 100);
  }
  return Math.round(amount);
}
