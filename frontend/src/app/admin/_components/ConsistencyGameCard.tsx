'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Pencil } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  ConsistencyGameGroup,
  ConsistencyRule,
  ConsistencySeverity,
} from '@/lib/admin';
import { DeleteButton } from './DeleteButton';
import { EditMilestoneForm } from './EditMilestoneForm';
import { deleteMilestone } from '../actions';

const RULE_LABEL: Record<ConsistencyRule, string> = {
  PRE_RELEASE: 'Pre-release',
  NON_MONOTONIC: 'Non-monotonic',
  PLATFORM_SUM_EXCEEDS_GLOBAL: 'Platforms > global',
  PLATFORM_EXCEEDS_GLOBAL: 'Platform > global',
  MAGNITUDE_OUTLIER: 'Magnitude outlier',
};

function severityClasses(severity: ConsistencySeverity): string {
  return severity === 'high'
    ? 'border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200'
    : 'border-amber-300 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200';
}

function formatDate(iso: string | null): string {
  if (!iso) return 'undated';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function ConsistencyGameCard({
  group,
}: {
  group: ConsistencyGameGroup;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  // Every milestone referenced by another milestone's flag — the "other side"
  // of a conflict — so the reviewer can spot the pair even when only one row
  // carries the flag.
  const relatedIds = useMemo(() => {
    const set = new Set<string>();
    for (const list of Object.values(group.flags)) {
      for (const f of list) for (const id of f.relatedMilestoneIds) set.add(id);
    }
    return set;
  }, [group.flags]);

  const ruleCounts = useMemo(() => {
    const counts = new Map<ConsistencyRule, number>();
    for (const list of Object.values(group.flags)) {
      for (const f of list) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
    }
    return [...counts.entries()];
  }, [group.flags]);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link
            href={`/admin/games/${group.gameId}`}
            className="hover:text-primary hover:underline"
          >
            {group.gameName}
          </Link>
          <span className="text-muted-foreground text-xs font-normal">
            Released {formatDate(group.releaseDate)}
          </span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-1.5">
          {ruleCounts.map(([rule, count]) => (
            <Badge key={rule} variant="outline" className="text-[11px]">
              {RULE_LABEL[rule]}
              {count > 1 ? ` ×${count}` : ''}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Reported</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Issue</TableHead>
              <TableHead className="pr-6 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.milestones.map((m) => {
              const flags = group.flags[m.id];
              const isFlagged = Boolean(flags?.length);
              const isRelated = !isFlagged && relatedIds.has(m.id);
              const hasHigh = flags?.some((f) => f.severity === 'high');
              return (
                <Fragment key={m.id}>
                  <TableRow
                    className={
                      isFlagged
                        ? hasHigh
                          ? 'border-l-2 border-l-rose-400 bg-rose-50/40 dark:bg-rose-950/20'
                          : 'border-l-2 border-l-amber-400 bg-amber-50/40 dark:bg-amber-950/20'
                        : isRelated
                          ? 'border-l-2 border-l-sky-300 bg-sky-50/30 dark:bg-sky-950/20'
                          : undefined
                    }
                  >
                    <TableCell className="text-muted-foreground pl-6 text-sm whitespace-nowrap">
                      {formatDate(m.reportedAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1">
                        <Badge
                          variant={
                            m.platform === 'GLOBAL' ? 'secondary' : 'outline'
                          }
                          className="text-[10px] tracking-wide uppercase"
                        >
                          {m.platform}
                        </Badge>
                        {m.isEngagement && (
                          <Badge
                            variant="outline"
                            className="text-[10px] tracking-wide uppercase"
                          >
                            Engagement
                          </Badge>
                        )}
                        {m.isEstimate && (
                          <Badge
                            variant="outline"
                            className="text-[10px] tracking-wide uppercase"
                          >
                            Estimate
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.units.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      {m.sourceUrl ? (
                        <a
                          href={m.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={m.sourceUrl}
                          className="text-primary inline-flex max-w-[160px] items-center gap-1 truncate text-xs hover:underline"
                        >
                          {hostnameOf(m.sourceUrl)}
                          <ExternalLink
                            aria-hidden="true"
                            className="size-3 shrink-0"
                          />
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">
                          {m.source}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-md">
                      {isFlagged ? (
                        <ul className="flex flex-col gap-1">
                          {flags!.map((f, i) => (
                            <li key={i} className="flex flex-col gap-0.5">
                              <Badge
                                variant="outline"
                                className={`w-fit text-[10px] ${severityClasses(f.severity)}`}
                              >
                                {RULE_LABEL[f.rule]}
                              </Badge>
                              <span className="text-muted-foreground text-xs">
                                {f.message}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : isRelated ? (
                        <span className="text-muted-foreground text-xs italic">
                          Referenced by a conflict above/below.
                        </span>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setEditingId((v) => (v === m.id ? null : m.id))
                          }
                          aria-label="Edit milestone"
                        >
                          <Pencil aria-hidden="true" className="size-4" />
                        </Button>
                        <DeleteButton
                          action={deleteMilestone.bind(null, m.id)}
                          confirmMessage={`Delete this ${m.source} ${m.platform} milestone (${m.units.toLocaleString()} on ${formatDate(m.reportedAt)})?`}
                          iconOnly
                          label="Delete milestone"
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                  {editingId === m.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted/20">
                        <EditMilestoneForm
                          milestone={m}
                          gameId={group.gameId}
                          onClose={() => setEditingId(null)}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
