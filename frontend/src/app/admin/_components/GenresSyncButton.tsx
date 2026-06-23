'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { syncGenresFromIgdb } from '../actions';

export function GenresSyncButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  function onClick() {
    start(async () => {
      try {
        const result = await syncGenresFromIgdb();
        window.alert(
          `IGDB sync — fetched ${result.fetched}, inserted ${result.inserted}, updated ${result.updated}, skipped ${result.skipped}.`,
        );
        router.refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Sync failed');
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
      {pending ? 'Syncing…' : 'Sync IGDB genres'}
    </Button>
  );
}
