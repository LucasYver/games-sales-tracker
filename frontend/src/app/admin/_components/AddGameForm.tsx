'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addGameByIgdbUrl, type AddGameResult } from '../actions';

type Feedback =
  | { kind: 'success'; result: AddGameResult }
  | { kind: 'error'; message: string }
  | null;

export function AddGameForm() {
  const [url, setUrl] = useState('');
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, startTx] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) return;

    setFeedback(null);
    startTx(async () => {
      try {
        const result = await addGameByIgdbUrl(trimmed);
        setFeedback({ kind: 'success', result });
        setUrl('');
      } catch (err) {
        setFeedback({
          kind: 'error',
          message: extractErrorMessage(err),
        });
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-[20rem] flex-1 flex-col gap-1.5">
          <Label htmlFor="igdb-url">IGDB URL</Label>
          <Input
            id="igdb-url"
            type="url"
            inputMode="url"
            placeholder="https://www.igdb.com/games/elden-ring"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={pending}
            required
          />
        </div>
        <Button type="submit" disabled={pending || url.trim().length === 0}>
          {pending ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Plus aria-hidden="true" className="size-4" />
          )}
          {pending ? 'Adding…' : 'Add game'}
        </Button>
      </div>

      {feedback?.kind === 'success' && (
        <p className="text-sm">
          <span className="text-green-600 dark:text-green-400">
            {feedback.result.alreadyExisted
              ? 'Already tracked: '
              : 'Added: '}
          </span>
          <Link
            href={`/admin/games/${feedback.result.gameId}`}
            className="hover:text-primary font-medium hover:underline"
          >
            {feedback.result.name}
          </Link>
          {!feedback.result.alreadyExisted && (
            <span className="text-muted-foreground">
              {feedback.result.steamLinked
                ? ' — Steam source attached, full ingest running.'
                : ' — IGDB-only ingest (no Steam app linked).'}
            </span>
          )}
        </p>
      )}

      {feedback?.kind === 'error' && (
        <p className="text-destructive text-sm">{feedback.message}</p>
      )}
    </form>
  );
}

function extractErrorMessage(err: unknown): string {
  if (!(err instanceof Error)) return 'Failed to add game.';

  // adminFetch wraps the backend response body in its error message. Try to
  // pull the Nest exception `message` field out of it so the user sees a
  // clean sentence instead of a raw 400 + JSON payload.
  const jsonStart = err.message.indexOf('{');
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(err.message.slice(jsonStart)) as {
        message?: string | string[];
      };
      if (Array.isArray(parsed.message)) return parsed.message.join(', ');
      if (typeof parsed.message === 'string') return parsed.message;
    } catch {
      // fall through
    }
  }
  return err.message;
}
