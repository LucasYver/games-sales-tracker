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
    const confirmed = window.confirm(
      'Re-scrape every source for this game and rebuild the full estimate history from scratch. All SalesEstimate and EstimateSnapshot rows will be replayed against the current multipliers.',
    );
    if (!confirmed) return;

    start(async () => {
      try {
        const result = await refreshGame(gameId);
        window.alert(
          result.found
            ? `Refresh done — ${result.articlesIngested} article(s) ingested with figures. Estimate history rebuilt.`
            : 'Game not found.',
        );
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Refresh failed');
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
      {pending ? 'Refreshing…' : 'Refresh & rebuild'}
    </Button>
  );
}
