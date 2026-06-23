'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runPublisherBackfill } from '../actions';

export function PublisherBackfillButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  function onClick() {
    start(async () => {
      try {
        const result = await runPublisherBackfill();
        window.alert(
          `Backfill done — ${result.linked} newly linked, ${result.alreadyLinked} already linked, ${result.unmatched} unmatched.`,
        );
        router.refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Backfill failed');
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
      {pending ? 'Backfilling…' : 'Re-link games'}
    </Button>
  );
}
