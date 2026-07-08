'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DatabaseBackup } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runSteamPsBackfill } from '../actions';

export function SteamPsBackfillButton() {
  const [pending, start] = useTransition();
  const router = useRouter();

  function onClick() {
    const confirmed = window.confirm(
      'Backfill every game still missing Steam CCU, reviews, followers or console store ratings. ' +
        'Runs in the background (progress in server logs); a second launch is refused while one is in flight.',
    );
    if (!confirmed) return;

    start(async () => {
      try {
        const result = await runSteamPsBackfill();
        if (result.alreadyRunning) {
          window.alert('A backfill is already running — check the server logs.');
        } else if (!result.started) {
          window.alert('Nothing to backfill: every game already has its history.');
        } else {
          const { tasks } = result;
          window.alert(
            `Backfill started for ${result.games} game(s):\n` +
              `• CCU: ${tasks.ccu}\n` +
              `• Reviews: ${tasks.reviews}\n` +
              `• Followers: ${tasks.followers}\n` +
              `• Store ratings: ${tasks.ratings}\n\n` +
              'Progress is in the server logs.',
          );
        }
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
      <DatabaseBackup
        aria-hidden="true"
        className={`size-4 ${pending ? 'animate-pulse' : ''}`}
      />
      {pending ? 'Starting…' : 'Backfill Steam/PS'}
    </Button>
  );
}
