/**
 * Last-resort filter for figures the LLM should have rejected: detects
 * unambiguous markers of a periodic (week/month/quarter/launch) figure or a
 * non-sales metric (players, downloads, concurrent users) that would
 * otherwise be mistaken for a cumulative lifetime total.
 *
 * Two-tier logic:
 *  1. If the quote contains an explicit lifetime marker (`lifetime`,
 *     `cumulative`, `to date`, `since launch`, `worldwide sales`…) AND a
 *     copies/units count, we trust it and let it through — even if the
 *     same quote also mentions a fiscal-period anchor (e.g. "as of FY24")
 *     or an aside about revenue ("$200M in revenue"). This is necessary
 *     to capture publisher quotes like "5M units sold lifetime as of
 *     FY2024" that legitimately mix units + period + currency in one
 *     sentence.
 *  2. Otherwise, fall back to the periodic-pattern list below. Patterns
 *     are kept narrow: each one must encode a context that cannot
 *     reasonably mean "as of [period]". When in doubt, the LLM prompt
 *     and date-grounding catch the rest.
 */

const LIFETIME_MARKERS =
  /\b(?:lifetime|cumulative|to\s+date|in\s+total|since\s+(?:its\s+)?(?:launch|release)|all[- ]time|worldwide\s+sales?|total\s+sales?\s+(?:of|reach(?:ed|ing)?))\b/i;

const UNITS_COUNT =
  /\b\d[\d,.]*\s*(?:million|billion|thousand|k|m|bn)?\s+(?:copies|units)\b/i;

function hasLifetimeUnitsLanguage(quote: string): boolean {
  return LIFETIME_MARKERS.test(quote) && UNITS_COUNT.test(quote);
}

const PERIODIC_PATTERNS: RegExp[] = [
  // Launch / opening windows
  /\b(?:in|during|over|within)\s+(?:its|the)\s+(?:first|opening|launch)\s+(?:24\s*hours?|day|week|weekend|month|30\s*days|quarter)\b/i,
  /\b(?:first|opening|launch)\s+(?:24\s*hours?|day|week|weekend|month|30\s*days)\s+sales?\b/i,
  /\bin\s+(?:its|the)\s+first\s+\d+\s+(?:hours?|days?|weeks?|months?)\b/i,

  // Quarterly windows — only when Q[1-4] is clearly the WINDOW
  /\b(?:in|during|over|for)\s+Q[1-4]\b/i,
  /\bQ[1-4]\s+(?:sales|results|revenue|earnings|figures|performance)\b/i,
  /\b(?:first|second|third|fourth)\s+quarter\s+(?:sales|of)\b/i,

  // Fiscal-period figures — reject only when FY is the REPORTING WINDOW
  // ("in FY24 sold X" / "FY24 sales") not the report TIMESTAMP
  // ("as of FY24 the title has sold X cumulatively").
  /\b(?:in|during|over|within|for|throughout|across)\s+FY\s?\d{2,4}\b/i,
  /\bFY\s?\d{2,4}\s+(?:sales|results|figures|revenue|earnings|performance)\b/i,
  /\b(?:in|during|over|within|for|throughout)\s+fiscal\s+(?:year|Q[1-4])\b/i,
  /\bfiscal\s+(?:year|Q[1-4])\s+(?:sales|results|revenue|earnings|figures)\b/i,

  // Recurring period descriptors
  /\bweekly\s+sales\b/i,
  /\bmonthly\s+sales\b/i,
  /\b(?:this|last|past)\s+(?:week|month|quarter)\b/i,

  // Monetary / revenue figures — only when the currency or amount is
  // anchored to a revenue/earnings verb or noun. We deliberately don't
  // reject quotes that merely cite a currency value somewhere
  // (e.g. "5M units sold, $200M revenue"): those are rescued upstream
  // by hasLifetimeUnitsLanguage.
  /(?:US?\$|€|£|¥)\s?\d[\d,.]*\s*(?:million|billion|m|bn|k|thousand)?\s+(?:in\s+)?(?:sales|revenue|earnings|turnover|gross|grossing)\b/i,
  /\b(?:grossed|earned|generated|brought\s+in|raked\s+in)\s+(?:US?\$|€|£|¥)?\s?\d[\d,.]*\s*(?:million|billion|m|bn|k|thousand)?\b(?!\s+(?:copies|units))/i,
  /\b\d[\d,.]*\s*(?:million|billion)\s+(?:in\s+(?:sales|revenue|earnings)|revenue|earnings|turnover)\b/i,

  // Non-sales metrics that the LLM may pull in by mistake. Allow an
  // optional adjective (concurrent / active / monthly / daily / peak /
  // registered) between the count and the metric noun, so phrases like
  // "5 million concurrent players" are caught.
  /\b\d[\d,.]*\s*(?:million|thousand|billion)?\s+(?:concurrent\s+|active\s+|monthly\s+|daily\s+|peak\s+|registered\s+)?(?:players|downloads|installs|sign[- ]?ups|concurrent\s+users?|active\s+users?|subscribers|users)\b/i,

  // Subscription-service engagement (Game Pass, PS Plus, Ubisoft+, EA Play…)
  // — out of scope for sales tracking
  /\b(?:game\s*pass|ps\s*plus|playstation\s*plus|ubisoft\s*\+|ea\s*play|apple\s*arcade|netflix\s*games?)\s+(?:players|subscribers|users)\b/i,
];

export function isPeriodicQuote(quote: string): boolean {
  if (hasLifetimeUnitsLanguage(quote)) return false;
  return PERIODIC_PATTERNS.some((re) => re.test(quote));
}
