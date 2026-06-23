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
  // Daily snapshot of Steam's GetNumberOfCurrentPlayers (raw value at poll time).
  STEAM_CONCURRENT = 'STEAM_CONCURRENT',
  // Running all-time max of STEAM_CONCURRENT seen for this game. A new row
  // is written only when a reading strictly exceeds the prior maximum value.
  // IMPORTANT: order rows by `value DESC` (not capturedAt) to find the
  // current peak — the historical-import path writes peak rows with an old
  // `capturedAt` (the SteamCharts month of the peak), so the most-recent
  // row by date is NOT always the largest.
  STEAM_PEAK_CCU = 'STEAM_PEAK_CCU',
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

/**
 * How representative Steam is of a publisher's PC sales. Drives how
 * aggressively Boxleiter / peak-CCU Steam estimates can be trusted as a
 * proxy for *total* PC sales:
 *  - STEAM_DOMINANT: Steam ≈ 90%+ of PC. Most indie + many AAA titles.
 *    Boxleiter/CCU on Steam ≈ total PC, multipliers used as-is.
 *  - MULTI_STORE: Steam ≈ 40-70% of PC. Game also ships on a significant
 *    competing PC store (EGS, GOG). Boxleiter on Steam undershoots total
 *    PC by ~2x.
 *  - LAUNCHER_PRIMARY: Steam ≈ 10-25% of PC. The publisher's own launcher
 *    (Ubisoft Connect, EA App, Battle.net, Microsoft Store) is the
 *    dominant PC entry point. Boxleiter on Steam undershoots total PC
 *    by 3-5×.
 *
 * Currently stored as `Publisher.launcherProfile` (and inherited by every
 * game linked to that publisher). Not yet consumed by the estimation
 * engine — captured here so the admin can curate the data ahead of the
 * follow-up calibration work.
 */
export enum LauncherProfile {
  STEAM_DOMINANT = 'STEAM_DOMINANT',
  MULTI_STORE = 'MULTI_STORE',
  LAUNCHER_PRIMARY = 'LAUNCHER_PRIMARY',
}
