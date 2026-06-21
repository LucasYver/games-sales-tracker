'use client';

import { useTransition } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { refreshGame } from '../actions';

interface Props {
  gameId: string;
}

export function RefreshGameButton({ gameId }: Props) {
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      try {
        const result = await refreshGame(gameId);
        // eslint-disable-next-line no-alert
        alert(
          result.found
            ? `Refresh done — ${result.articlesIngested} article(s) ingested with figures.`
            : 'Game not found.',
        );
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert(err instanceof Error ? err.message : 'Refresh failed');
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending}
    >
      <RefreshCw
        aria-hidden="true"
        className={`size-4 ${pending ? 'animate-spin' : ''}`}
      />
      {pending ? 'Refreshing…' : 'Refresh data'}
    </Button>
  );
}
