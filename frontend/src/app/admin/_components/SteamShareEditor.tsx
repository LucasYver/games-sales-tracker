'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { updatePublisherSteamShare } from '../actions';

interface Props {
  publisherId: string;
  low: number;
  high: number;
}

export function SteamShareEditor({ publisherId, low, high }: Props) {
  const [lowValue, setLowValue] = useState(String(low));
  const [highValue, setHighValue] = useState(String(high));
  const [pending, start] = useTransition();
  const router = useRouter();

  const parsedLow = Number(lowValue);
  const parsedHigh = Number(highValue);
  const invalid =
    !Number.isFinite(parsedLow) ||
    !Number.isFinite(parsedHigh) ||
    parsedLow < 1 ||
    parsedHigh > 100 ||
    parsedLow > parsedHigh;
  const unchanged = parsedLow === low && parsedHigh === high;

  function onSave() {
    if (invalid || unchanged) return;
    start(async () => {
      try {
        await updatePublisherSteamShare(publisherId, parsedLow, parsedHigh);
        router.refresh();
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'Failed to update Steam share.',
        );
      }
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">Low (%)</span>
        <Input
          type="number"
          min={1}
          max={100}
          step={1}
          value={lowValue}
          onChange={(e) => setLowValue(e.target.value)}
          className="h-8 w-24"
          disabled={pending}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">High (%)</span>
        <Input
          type="number"
          min={1}
          max={100}
          step={1}
          value={highValue}
          onChange={(e) => setHighValue(e.target.value)}
          className="h-8 w-24"
          disabled={pending}
        />
      </label>
      <Button
        type="button"
        size="sm"
        onClick={onSave}
        disabled={pending || invalid || unchanged}
      >
        {pending ? 'Saving…' : 'Save'}
      </Button>
      {invalid && (
        <p className="text-destructive w-full text-xs">
          Low must be between 1 and 100 and not greater than High.
        </p>
      )}
    </div>
  );
}
