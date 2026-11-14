import { track } from '@vercel/analytics';

/**
 * Every Vercel Web Analytics custom event the public site sends, with its
 * properties. A closed list keeps names from splitting into typo variants in
 * the dashboard. Vercel Pro keeps at most 2 properties per event and 255
 * characters per value, so each event stays within that.
 *
 * Only deliberate actions are tracked (a click, a choice) — never hover,
 * scroll or keystrokes — because each event counts against the Analytics
 * quota. The admin has its own layout without <Analytics />, so nothing
 * here fires from the back office.
 */
type Events = {
  // Search
  search_result_click: { game: string; position: number };
  search_no_result: { query: string };
  // Listing filters
  filter_change: { filter: string; value: string };
  filter_reset: Record<string, never>;
  pagination: { page: number };
  // Outbound links
  outbound_click: { from: string; domain: string };
  instant_gaming_click: { game: string; placement: string };
  // Charts
  chart_range_change: { chart: string; range: string };
  platform_chart_select: { platform: string };
  price_country_change: { country: string };
  price_store_change: { store: string };
  price_section_open: { section: string };
  // Game comparison: where a comparison starts, which chart and table
  // options are used, and how often a comparison is shared.
  compare_pick: { from: string; game: string };
  compare_option: { option: string; value: string };
  link_copy: { page: string };
  // Site preferences
  language_change: { to: string };
  theme_toggle: { theme: string };
};

export type AnalyticsEvent = keyof Events;

const MAX_VALUE = 255;

export function trackEvent<E extends AnalyticsEvent>(
  name: E,
  ...[props]: Events[E] extends Record<string, never> ? [] : [Events[E]]
) {
  try {
    if (!props) {
      track(name);
      return;
    }
    const clean: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(props)) {
      clean[key] =
        typeof value === 'string' ? value.slice(0, MAX_VALUE) : value;
    }
    track(name, clean);
  } catch {
    /* analytics must never break the page */
  }
}

/** Hostname without "www.", for grouping outbound clicks by site. */
export function linkDomain(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}
