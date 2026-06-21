/**
 * Last-resort filter for figures the LLM should have rejected: detects
 * unambiguous markers of a periodic (week/month/quarter/launch) figure or a
 * non-sales metric (players, downloads, concurrent users) that would
 * otherwise be mistaken for a cumulative lifetime total.
 *
 * Only matches phrases that cannot reasonably mean "as of [period]" — we err
 * on the side of letting ambiguous wording through (the LLM prompt and
 * date-grounding catch most issues; this is the safety net).
 */
const PERIODIC_PATTERNS: RegExp[] = [
  // Launch / opening windows
  /\b(?:in|during|over|within)\s+(?:its|the)\s+(?:first|opening|launch)\s+(?:24\s*hours?|day|week|weekend|month|30\s*days|quarter)\b/i,
  /\b(?:first|opening|launch)\s+(?:24\s*hours?|day|week|weekend|month|30\s*days)\s+sales?\b/i,
  /\bin\s+(?:its|the)\s+first\s+\d+\s+(?:hours?|days?|weeks?|months?)\b/i,
  // Quarterly windows
  /\b(?:in|during)\s+Q[1-4]\b/i,
  /\b(?:first|second|third|fourth)\s+quarter\s+(?:sales|of)\b/i,
  // Fiscal year windows — periodic, not cumulative lifetime
  /\bFY\s?\d{2,4}\b/i,
  /\bfiscal\s+(?:year|Q[1-4])\b/i,
  // Recurring period descriptors
  /\bweekly\s+sales\b/i,
  /\bmonthly\s+sales\b/i,
  /\b(?:this|last|past)\s+(?:week|month|quarter)\b/i,
  // Monetary / revenue figures — "$X million in sales" is revenue, NOT units.
  // Any explicit currency sign in a quote almost always indicates a revenue
  // figure, even when the word "sales" appears next to it.
  /(?:US?\$|€|£|¥)\s?\d[\d,.]*\s*(?:million|billion|m|bn|k)?\b/i,
  /\b\d[\d,.]*\s*(?:million|billion)\s+(?:in\s+(?:sales|revenue|earnings)|revenue|earnings|turnover)\b/i,
  // Non-sales metrics that the LLM may pull in by mistake
  /\b\d[\d,.]*\s*(?:million|thousand|billion)?\s+(?:players|downloads|installs|sign[- ]?ups|concurrent\s+users?|active\s+users?|subscribers)\b/i,
  // Subscription-service engagement (Game Pass, PS Plus, Ubisoft+, EA Play…)
  // — out of scope for sales tracking
  /\b(?:game\s*pass|ps\s*plus|playstation\s*plus|ubisoft\s*\+|ea\s*play|apple\s*arcade|netflix\s*games?)\s+(?:players|subscribers|users)\b/i,
];

export function isPeriodicQuote(quote: string): boolean {
  return PERIODIC_PATTERNS.some((re) => re.test(quote));
}
