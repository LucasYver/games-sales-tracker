'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, Rss, Search } from 'lucide-react';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ClearSourceMilestonesButton } from '../_components/ClearSourceMilestonesButton';
import { DeleteButton } from '../_components/DeleteButton';
import { ToggleSourceActiveButton } from '../_components/ToggleSourceActiveButton';
import {
  deleteTrustedSource,
  rejectTrustedSourceMilestones,
  setTrustedSourceActive,
} from '../actions';

const SORT_COLUMNS = [
  'name',
  'category',
  'salesSource',
  'host',
  'language',
  'recordCount',
  'capabilities',
] as const;

type SortColumn = (typeof SORT_COLUMNS)[number];
type SortDirection = 'asc' | 'desc';

export type TrustedSourceRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  salesSource: string;
  host: string | null;
  handle: string | null;
  url: string | null;
  searchUrlTemplate: string | null;
  feedUrl: string | null;
  language: string;
  active: boolean;
  autoCreated: boolean;
  recordCount?: number;
};

function hostLabel(ts: TrustedSourceRow): string {
  return ts.host ?? (ts.handle ? `@${ts.handle}` : '');
}

function capabilitiesKey(ts: TrustedSourceRow): string {
  const parts: string[] = [];
  if (ts.feedUrl) parts.push('rss');
  if (ts.searchUrlTemplate) parts.push('search');
  if (ts.url) parts.push('site');
  return parts.join(' ');
}

function sortValue(
  ts: TrustedSourceRow,
  column: SortColumn,
): string | number {
  switch (column) {
    case 'name':
      return ts.name;
    case 'category':
      return ts.category;
    case 'salesSource':
      return ts.salesSource;
    case 'host':
      return hostLabel(ts);
    case 'language':
      return ts.language;
    case 'recordCount':
      return ts.recordCount ?? 0;
    case 'capabilities':
      return capabilitiesKey(ts);
  }
}

function compareSources(
  a: TrustedSourceRow,
  b: TrustedSourceRow,
  column: SortColumn,
  direction: SortDirection,
): number {
  const dir = direction === 'asc' ? 1 : -1;
  const av = sortValue(a, column);
  const bv = sortValue(b, column);
  if (typeof av === 'number' && typeof bv === 'number') {
    return (av - bv) * dir;
  }
  return (
    String(av).localeCompare(String(bv), undefined, {
      numeric: true,
      sensitivity: 'base',
    }) * dir
  );
}

function SortableHead({
  column,
  label,
  align = 'left',
  sort,
  direction,
  onSort,
}: {
  column: SortColumn;
  label: string;
  align?: 'left' | 'right';
  sort: SortColumn;
  direction: SortDirection;
  onSort: (column: SortColumn) => void;
}) {
  const isActive = sort === column;
  const indicator = !isActive ? '↕' : direction === 'asc' ? '↑' : '↓';

  return (
    <TableHead className={align === 'right' ? 'text-right' : undefined}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`hover:text-foreground inline-flex items-center gap-1 ${
          isActive ? 'text-foreground' : ''
        } ${align === 'right' ? 'ml-auto' : ''}`}
      >
        {label}
        <span className={`text-xs ${isActive ? '' : 'opacity-40'}`}>
          {indicator}
        </span>
      </button>
    </TableHead>
  );
}

export function SourcesTable({
  sources,
  emptyMessage,
}: {
  sources: TrustedSourceRow[];
  emptyMessage: string;
}) {
  const [sort, setSort] = useState<SortColumn>('name');
  const [direction, setDirection] = useState<SortDirection>('asc');

  function onSort(column: SortColumn) {
    if (sort === column) {
      setDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSort(column);
    setDirection(column === 'recordCount' ? 'desc' : 'asc');
  }

  const sorted = useMemo(
    () =>
      [...sources].sort((a, b) => compareSources(a, b, sort, direction)),
    [sources, sort, direction],
  );

  return (
    <Card>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableHead
              column="name"
              label="Name"
              sort={sort}
              direction={direction}
              onSort={onSort}
            />
            <SortableHead
              column="category"
              label="Category"
              sort={sort}
              direction={direction}
              onSort={onSort}
            />
            <SortableHead
              column="salesSource"
              label="Tier"
              sort={sort}
              direction={direction}
              onSort={onSort}
            />
            <SortableHead
              column="host"
              label="Host / Handle"
              sort={sort}
              direction={direction}
              onSort={onSort}
            />
            <SortableHead
              column="language"
              label="Lang"
              sort={sort}
              direction={direction}
              onSort={onSort}
            />
            <SortableHead
              column="recordCount"
              label="Records"
              align="right"
              sort={sort}
              direction={direction}
              onSort={onSort}
            />
            <SortableHead
              column="capabilities"
              label="Capabilities"
              sort={sort}
              direction={direction}
              onSort={onSort}
            />
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sorted.map((ts) => (
            <TableRow key={ts.id}>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{ts.name}</span>
                  {ts.autoCreated && (
                    <Badge
                      variant="outline"
                      className="border-amber-300 bg-amber-50 text-[10px] tracking-wide text-amber-800 uppercase dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
                      title="Auto-created by the ingestion pipeline. Review the tier before relying on it."
                    >
                      auto
                    </Badge>
                  )}
                </div>
                <div className="text-muted-foreground font-mono text-xs">
                  {ts.slug}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{ts.category}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{ts.salesSource}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-xs">
                {hostLabel(ts) || '—'}
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {ts.language}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {ts.recordCount ? (
                  <span className="font-medium">
                    {ts.recordCount.toLocaleString()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">0</span>
                )}
              </TableCell>
              <TableCell>
                <div className="flex flex-wrap gap-1">
                  {ts.feedUrl && (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Rss aria-hidden="true" className="size-3" />
                      RSS
                    </Badge>
                  )}
                  {ts.searchUrlTemplate && (
                    <Badge variant="outline" className="gap-1 text-xs">
                      <Search aria-hidden="true" className="size-3" />
                      Search
                    </Badge>
                  )}
                  {ts.url && (
                    <a
                      href={ts.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                    >
                      site
                      <ExternalLink aria-hidden="true" className="size-3" />
                    </a>
                  )}
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-0.5">
                  <ClearSourceMilestonesButton
                    action={rejectTrustedSourceMilestones.bind(null, ts.id)}
                    name={ts.name}
                    recordCount={ts.recordCount ?? 0}
                  />
                  <ToggleSourceActiveButton
                    action={setTrustedSourceActive.bind(
                      null,
                      ts.id,
                      !ts.active,
                    )}
                    active={ts.active}
                    name={ts.name}
                  />
                  <DeleteButton
                    action={deleteTrustedSource.bind(null, ts.id)}
                    confirmMessage={`Delete trusted source "${ts.name}"?`}
                    iconOnly
                    label={`Delete ${ts.name}`}
                  />
                </div>
              </TableCell>
            </TableRow>
          ))}
          {sorted.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={8}
                className="text-muted-foreground py-12 text-center"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Card>
  );
}
