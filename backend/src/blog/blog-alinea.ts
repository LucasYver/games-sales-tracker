import { SalesSource } from '../entities';

const ALINEA_HOSTS = ['alineaanalytics.com', 'alineaanalytics.substack.com'];
const ALINEA_NAME = /alinea|rhys\s+elliott?/i;

export function isAlineaMilestone(row: {
  publisher?: string | null;
  note?: string | null;
  sourceUrl?: string | null;
}): boolean {
  const blob = `${row.publisher ?? ''} ${row.note ?? ''} ${row.sourceUrl ?? ''}`;
  if (ALINEA_NAME.test(blob)) return true;
  if (!row.sourceUrl) return false;
  try {
    const host = new URL(row.sourceUrl).hostname.replace(/^www\./, '');
    return ALINEA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** Sourced sales/engagement figure we may show on the blog. Leaks stay out. */
export function isBlogEligibleMilestone(row: {
  source: SalesSource;
  isEstimate: boolean;
  publisher?: string | null;
  note?: string | null;
  sourceUrl?: string | null;
}): boolean {
  if (
    row.source === SalesSource.STEAM_LEAK ||
    row.source === SalesSource.PLAYSTATION_LEAK
  ) {
    return false;
  }
  if (row.isEstimate && !isAlineaMilestone(row)) return false;
  return true;
}

export function sourceDisplayName(row: {
  source: SalesSource;
  publisher?: string | null;
  note?: string | null;
  sourceUrl?: string | null;
}): string {
  if (isAlineaMilestone(row)) return 'Alinea Analytics';
  if (row.publisher?.trim()) return row.publisher.trim();
  switch (row.source) {
    case SalesSource.OFFICIAL:
      return 'the publisher';
    case SalesSource.WIKIPEDIA:
      return 'Wikipedia';
    case SalesSource.ANNOUNCEMENT:
      return 'a publisher announcement';
    default:
      return 'the press';
  }
}
