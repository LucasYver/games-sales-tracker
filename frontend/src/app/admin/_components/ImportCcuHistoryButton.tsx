'use client';

import { useTransition } from 'react';
import { TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { importCcuHistory } from '../actions';

interface Props {
  gameId: string;
}

function formatPeakAt(iso: string | null): string {
  if (!iso) return 'unknown date';
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
  });
}

function describeResult(result: {
  appId: number | null;
  importedPeak: number | null;
  peakAt: string | null;
  priorPeak: number | null;
  persisted: boolean;
}): string {
  if (result.appId === null) {
    return 'No Steam app linked to this game — nothing to import.';
  }
  if (result.importedPeak === null) {
    return 'SteamCharts returned no peak (appId not indexed yet, or rate-limited). Try again later.';
  }
  const peak = result.importedPeak.toLocaleString();
  const at = formatPeakAt(result.peakAt);
  if (!result.persisted) {
    const prior =
      result.priorPeak !== null ? result.priorPeak.toLocaleString() : 'n/a';
    return `SteamCharts peak ${peak} (${at}) is not higher than existing ${prior} — no snapshot written.`;
  }
  return `Imported all-time peak ${peak} CCU (${at}). New STEAM_PEAK_CCU snapshot saved.`;
}

export function ImportCcuHistoryButton({ gameId }: Props) {
  const [pending, start] = useTransition();

  function onClick() {
    start(async () => {
      try {
        const result = await importCcuHistory(gameId);
        window.alert(describeResult(result));
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Import failed');
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
      <TrendingUp
        aria-hidden="true"
        className={`size-4 ${pending ? 'animate-pulse' : ''}`}
      />
      {pending ? 'Importing…' : 'Import CCU history'}
    </Button>
  );
}
