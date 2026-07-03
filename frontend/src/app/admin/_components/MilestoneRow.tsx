'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Pencil } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AdminMilestone } from '@/lib/admin';
import { DeleteButton } from './DeleteButton';
import { EditMilestoneForm } from './EditMilestoneForm';
import { deleteMilestone } from '../actions';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
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

/**
 * Single canonical milestone row, shared by the per-game "Milestones" tab
 * and the cross-game /admin/milestones listing. `gameName` is only passed
 * on the cross-game listing, which adds a leading "Game" column linking
 * back to the game's admin page.
 */
export function MilestoneRow({
  milestone: m,
  gameName,
}: {
  milestone: AdminMilestone;
  gameName?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const columnCount = gameName ? 9 : 8;

  return (
    <>
      <TableRow>
        {gameName && (
          <TableCell>
            <Link
              href={`/admin/games/${m.gameId}`}
              className="hover:text-primary hover:underline"
            >
              {gameName}
            </Link>
          </TableCell>
        )}
        <TableCell>
          <div className="flex flex-wrap items-center gap-1">
            <Badge variant="outline">{m.source}</Badge>
            {m.platform !== 'GLOBAL' && (
              <Badge
                variant="secondary"
                className="border-sky-300 bg-sky-100 text-[10px] tracking-wide text-sky-800 uppercase dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200"
                title="Single-platform sales figure (e.g. copies sold on Steam / PlayStation). Stored to learn the PC-vs-console split."
              >
                {m.platform}
              </Badge>
            )}
            {m.isEngagement && (
              <Badge
                variant="secondary"
                className="border-amber-300 bg-amber-100 text-[10px] tracking-wide text-amber-800 uppercase dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                title="Players-reached / engagement milestone (includes subscription users like Ubisoft+/Game Pass). Excluded from estimation."
              >
                Engagement
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell>
          {m.sourceUrl ? (
            <a
              href={m.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={m.sourceUrl}
              className="text-primary inline-flex max-w-[200px] items-center gap-1 truncate text-xs hover:underline"
            >
              {hostnameOf(m.sourceUrl)}
              <ExternalLink aria-hidden="true" className="size-3 shrink-0" />
            </a>
          ) : (
            <span className="text-muted-foreground text-xs">—</span>
          )}
        </TableCell>
        <TableCell
          className="text-muted-foreground max-w-[160px] truncate text-sm"
          title={m.publisher ?? undefined}
        >
          {m.publisher ?? '—'}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {m.units.toLocaleString()}
        </TableCell>
        <TableCell className="text-muted-foreground text-right text-sm tabular-nums">
          {m.confidenceScore == null ? '—' : Math.round(m.confidenceScore)}
        </TableCell>
        <TableCell className="text-muted-foreground text-sm">
          {formatDate(m.reportedAt)}
        </TableCell>
        <TableCell
          className="text-muted-foreground max-w-xs truncate text-xs"
          title={m.note ?? undefined}
        >
          {m.note ?? '—'}
        </TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setIsEditing((v) => !v)}
              aria-label="Edit milestone"
            >
              <Pencil aria-hidden="true" className="size-4" />
            </Button>
            <DeleteButton
              action={deleteMilestone.bind(null, m.id)}
              confirmMessage={`Delete this ${m.source} milestone${gameName ? ` for ${gameName}` : ''}?`}
              iconOnly
              label="Delete milestone"
            />
          </div>
        </TableCell>
      </TableRow>
      {isEditing && (
        <TableRow>
          <TableCell colSpan={columnCount} className="bg-muted/20">
            <EditMilestoneForm
              milestone={m}
              gameId={m.gameId}
              onClose={() => setIsEditing(false)}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
