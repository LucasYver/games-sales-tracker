/**
 * Label of how a declared figure cross-checks against our independent
 * estimate. `strong` = declared falls in [estLow, estHigh]; `weak` =
 * slight mismatch explainable by growth or model spread; `conflict` =
 * one side is likely wrong. Computed by `GamesService.classifyAgreement`.
 */
export type Agreement = 'strong' | 'weak' | 'conflict';

export enum SourceType {
  IGDB = 'IGDB',
  STEAM = 'STEAM',
  STEAMSPY = 'STEAMSPY',
  PS_STORE = 'PS_STORE',
  XBOX_STORE = 'XBOX_STORE',
  NINTENDO_ESHOP = 'NINTENDO_ESHOP',
  WIKIPEDIA = 'WIKIPEDIA',
  EXOPHASE = 'EXOPHASE',
  MANUAL = 'MANUAL',
}

export enum Platform {
  PC = 'PC',
  PLAYSTATION = 'PLAYSTATION',
  XBOX = 'XBOX',
  SWITCH = 'SWITCH',
  MOBILE = 'MOBILE',
  // Cross-platform worldwide total (e.g. a publisher "X million copies sold"
  // figure that is not broken down by platform).
  GLOBAL = 'GLOBAL',
  OTHER = 'OTHER',
}

export enum SignalMetric {
  STEAM_REVIEWS = 'STEAM_REVIEWS',
  STEAM_CONCURRENT = 'STEAM_CONCURRENT',
  STEAMSPY_OWNERS = 'STEAMSPY_OWNERS',
  PS_RATINGS = 'PS_RATINGS',
  XBOX_RATINGS = 'XBOX_RATINGS',
  SWITCH_RATINGS = 'SWITCH_RATINGS',
}

export enum ConfidenceLevel {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
}

// Provenance of a sales figure, ordered from most to least reliable.
// Used to pick the best available number per platform.
export enum SalesSource {
  OFFICIAL = 'OFFICIAL', // publisher-declared (financial report, press release)
  WIKIPEDIA = 'WIKIPEDIA', // citation-backed figure extracted from Wikipedia
  ANNOUNCEMENT = 'ANNOUNCEMENT', // social/PR announcement (X, Instagram, email)
  MEDIA = 'MEDIA', // figure reported by a trusted media outlet / analyst
}

// Kind of trusted source in the curated registry that feeds media extraction.
export enum SourceCategory {
  MEDIA = 'MEDIA', // press / editorial outlet
  ANALYST = 'ANALYST', // market analyst (Circana, Niko, Ampere…)
  SOCIAL_X = 'SOCIAL_X', // X (Twitter) account
  OFFICIAL_IR = 'OFFICIAL_IR', // publisher investor-relations / official channel
}
