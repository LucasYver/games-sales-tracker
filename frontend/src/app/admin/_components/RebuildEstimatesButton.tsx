'use client';

import { useTransition } from 'react';
import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { rebuildEstimateHistory } from '../actions';

interface Props {
  gameId: string;
}

export function RebuildEstimatesButton({ gameId }: Props) {
  const [pending, start] = useTransition();

  function onClick() {
    const confirmed = window.confirm(
      'Wipe and replay the entire estimate history for this game using current multipliers? This deletes all SalesEstimate and EstimateSnapshot rows for the game before rebuilding.',
    );
    if (!confirmed) return;

    start(async () => {
      try {
        const result = await rebuildEstimateHistory(gameId);
        window.alert(
          `Rebuild done — ${result.points} historical capture moments, ${result.estimates} estimates, ${result.snapshots} snapshots.`,
        );
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Rebuild failed');
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
      <History
        aria-hidden="true"
        className={`size-4 ${pending ? 'animate-pulse' : ''}`}
      />
      {pending ? 'Rebuilding…' : 'Rebuild estimate history'}
    </Button>
  );
}
