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
  TWITCH = 'TWITCH',
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
  // Ground-truth unique-player count from the July 2018 Steam achievement
  // data leak (Ars Technica / Steam Spy). Stored as a dated snapshot
  // (capturedAt = 2018-07-01) purely as a calibration/validation target —
  // it is NOT a live signal and never feeds the estimation pipeline.
  STEAM_PLAYERS_LEAK = 'STEAM_PLAYERS_LEAK',
  PS_RATINGS = 'PS_RATINGS',
  XBOX_RATINGS = 'XBOX_RATINGS',
  SWITCH_RATINGS = 'SWITCH_RATINGS',
  // Steam followers = member count of the game's community group, a hype /
  // interest proxy that (unlike CCU) works for solo and multiplayer alike.
  // Sourced from games-popularity.com; higher = more followers. One row per
  // UTC day (latest reading of the day). History only reaches ~2024-03 (the
  // provider's collection start), NOT launch — see ingestion notes.
  STEAM_FOLLOWERS = 'STEAM_FOLLOWERS',
  // DEPRECATED — the games-popularity top-seller-rank feature was removed (it
  // wasn't useful). No code produces or consumes this metric anymore. The value
  // is retained only because migration 1782730000000 already added it to the
  // Postgres enum in prod (enum values can't be safely dropped); existing rows,
  // if any, are harmless dead data.
  STEAM_TOPSELLER_RANK = 'STEAM_TOPSELLER_RANK',
  // Total concurrent Twitch viewers across all live streams of the game, a
  // hype / mainstream-attention proxy (distinct from CCU: it counts watchers,
  // not players). Summed over the top live streams from the Twitch Helix
  // /streams endpoint (Twitch exposes no aggregate total). One row per UTC day
  // = that day's peak, mirroring STEAM_CONCURRENT. Forward-only: history starts
  // when collection begins (no free Twitch backfill exists).
  TWITCH_VIEWERS = 'TWITCH_VIEWERS',
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
  STEAM_LEAK = 'STEAM_LEAK', // July 2018 Steam leak: PC players ≈ buyers (paid games only)
  PLAYSTATION_LEAK = 'PLAYSTATION_LEAK', // Rhysida/Insomniac breach (Dec 2023): internal SIE first-party shipments as of 2022-02-27, PlayStation-scoped
}

// Kind of trusted source in the curated registry that feeds media extraction.
export enum SourceCategory {
  MEDIA = 'MEDIA', // press / editorial outlet
  ANALYST = 'ANALYST', // market analyst (Circana, Niko, Ampere…)
  SOCIAL_X = 'SOCIAL_X', // X (Twitter) account
  OFFICIAL_IR = 'OFFICIAL_IR', // publisher investor-relations / official channel
}

/**
 * Qualitative grade for how much a game type keeps selling past
 * year 1. Encoded as an ordered enum so callers can compare strengths.
 * Levels map 1:1 to the French wording from the empirical lifecycle
 * spreadsheet (Très forte → VERY_HIGH, etc.).
 *
 *   NEGATIVE   = year 2+ sells less than year 1 (e.g. annualised sport)
 *   VERY_LOW   = quasi-flat, one-and-done (e.g. narrative / walking sim)
 *   LOW        = finishable, modest tail
 *   LOW_MEDIUM = mostly one-and-done with seasonal blips
 *   MEDIUM     = healthy long tail driven by content updates
 *   MEDIUM_HIGH = strong but variance-heavy (viral / streamer effects)
 *   HIGH       = sustained live-service or replayable systemic
 *   VERY_HIGH  = exceptional tail (mods, UGC, social — Minecraft tier)
 */
export enum Year2Retention {
  NEGATIVE = 'NEGATIVE',
  VERY_LOW = 'VERY_LOW',
  LOW = 'LOW',
  LOW_MEDIUM = 'LOW_MEDIUM',
  MEDIUM = 'MEDIUM',
  MEDIUM_HIGH = 'MEDIUM_HIGH',
  HIGH = 'HIGH',
  VERY_HIGH = 'VERY_HIGH',
}

/**
 * Where a `Genre` row was sourced from. IGDB is our primary taxonomy
 * (matches `Game.genres` populated by `IgdbClient`); MANUAL is reserved
 * for hand-curated entries created in the admin. STEAM is a placeholder
 * for future Steam-tag ingestion.
 */
export enum GenreSource {
  IGDB = 'IGDB',
  STEAM = 'STEAM',
  MANUAL = 'MANUAL',
}

/**
 * Logical grouping of estimation methods.
 *  - BOXLEITER: signal × multiplier (default or calibrated).
 *  - ACHIEVEMENTS: Exophase / Steam achievement-based, dormant today.
 *  - LIFECYCLE: time-since-release projection (e.g. first-week sales
 *    extrapolated through a degressive curve to today).
 *  - PLATFORM_SPLIT: derivative method that ventilates one platform's
 *    estimate to another using a curated split (e.g. genre-aware PC
 *    → console). Inputs are other estimates, not raw signals.
 *  - AGGREGATE: weighted combination of other methods, written by
 *    `EstimationService.aggregateMethods`. Excluded from its own input.
 *  - MANUAL: reserved for future hand-entered overrides.
 */
export enum EstimationMethodFamily {
  BOXLEITER = 'BOXLEITER',
  ACHIEVEMENTS = 'ACHIEVEMENTS',
  LIFECYCLE = 'LIFECYCLE',
  PLATFORM_SPLIT = 'PLATFORM_SPLIT',
  AGGREGATE = 'AGGREGATE',
  MANUAL = 'MANUAL',
}
