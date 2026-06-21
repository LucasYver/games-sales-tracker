'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Database, Loader2, Play } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { IgdbBackfillStatus } from '@/lib/admin';
import {
  getIgdbBackfillStatus,
  startIgdbBackfill,
} from '../actions';

export function IgdbBackfillCard({ initial }: { initial: IgdbBackfillStatus }) {
  const [status, setStatus] = useState<IgdbBackfillStatus>(initial);
  const [pending, startTx] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await getIgdbBackfillStatus();
      setStatus(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status fetch failed');
    }
  }, []);

  useEffect(() => {
    if (!status.running) return;
    const id = setInterval(() => {
      void refresh();
    }, 2000);
    return () => clearInterval(id);
  }, [status.running, refresh]);

  function onStart() {
    setError(null);
    startTx(async () => {
      try {
        await startIgdbBackfill();
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start');
      }
    });
  }

  const progressPct =
    status.total > 0
      ? Math.round((status.processed / status.total) * 100)
      : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase">
          <Database aria-hidden="true" className="size-4" />
          IGDB backfill
        </CardTitle>
        <Button
          type="button"
          size="sm"
          onClick={onStart}
          disabled={pending || status.running}
        >
          {pending || status.running ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Play aria-hidden="true" className="size-4" />
          )}
          {status.running ? 'Running…' : 'Start backfill'}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Re-enriches every catalog entry with IGDB metadata (platforms,
          publisher, developer, cover, genres). Rate-limited to ~4 req/s; the
          full catalog takes a few minutes.
        </p>

        {status.total > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {status.processed.toLocaleString()} /{' '}
                {status.total.toLocaleString()} processed · {progressPct}%
              </span>
              <span className="flex gap-2">
                <Badge variant="secondary">
                  {status.updated.toLocaleString()} updated
                </Badge>
                <Badge variant="outline">
                  {status.skipped.toLocaleString()} skipped
                </Badge>
              </span>
            </div>
            <div
              className="bg-muted relative h-2 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuenow={progressPct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="bg-primary h-full transition-all"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {status.finishedAt && !status.running && (
          <p className="text-muted-foreground text-xs">
            Last run finished at{' '}
            {new Date(status.finishedAt).toLocaleString('en-US', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            .
          </p>
        )}

        {(error || status.lastError) && (
          <p className="text-destructive text-xs">
            {error ?? status.lastError}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
