import type { SalesSource } from '@/lib/admin';

export type SourceGroup = 'official' | 'media' | 'leak' | 'wikipedia';

// Four groups keep the dashboard charts readable: publisher statements,
// press, the Steam and PlayStation leaks, and Wikipedia citations.
export const SOURCE_GROUPS: Array<{
  key: SourceGroup;
  label: string;
  color: string;
  sources: SalesSource[];
}> = [
  {
    key: 'official',
    label: 'Official',
    color: 'var(--source-official)',
    sources: ['OFFICIAL', 'ANNOUNCEMENT'],
  },
  {
    key: 'media',
    label: 'Media',
    color: 'var(--source-media)',
    sources: ['MEDIA'],
  },
  {
    key: 'leak',
    label: 'Leaks',
    color: 'var(--source-leak)',
    sources: ['STEAM_LEAK', 'PLAYSTATION_LEAK'],
  },
  {
    key: 'wikipedia',
    label: 'Wikipedia',
    color: 'var(--source-wikipedia)',
    sources: ['WIKIPEDIA'],
  },
];

export function groupBySource(
  bySource: Record<SalesSource, number>,
): Record<SourceGroup, number> {
  const totals = { official: 0, media: 0, leak: 0, wikipedia: 0 };
  for (const group of SOURCE_GROUPS) {
    for (const source of group.sources) {
      totals[group.key] += bySource[source] ?? 0;
    }
  }
  return totals;
}
