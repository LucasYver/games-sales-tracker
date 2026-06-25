'use client';

import { useTransition } from 'react';
import { Hammer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { rebuildEstimates } from '../actions';

interface Props {
  gameId: string;
}

export function RebuildEstimatesButton({ gameId }: Props) {
  const [pending, start] = useTransition();

  function onClick() {
    const confirmed = window.confirm(
      'Rebuild the estimate history from the signals already on record — no source is re-scraped. All SalesEstimate and EstimateSnapshot rows are replayed against the current multipliers.',
    );
    if (!confirmed) return;

    start(async () => {
      try {
        const result = await rebuildEstimates(gameId);
        window.alert(
          `Rebuilt ${result.points} point(s): ${result.estimates} estimates, ${result.snapshots} snapshots.`,
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
      <Hammer
        aria-hidden="true"
        className={`size-4 ${pending ? 'animate-pulse' : ''}`}
      />
      {pending ? 'Rebuilding…' : 'Rebuild only'}
    </Button>
  );
}
