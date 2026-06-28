'use client';

import { useTransition } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { backfillReviews, type BackfillReviewsResult } from '../actions';

interface Props {
  gameId: string;
}

function describeResult(result: BackfillReviewsResult): string {
  const rating =
    result.latestRating !== null
      ? `${(result.latestRating * 100).toFixed(1)}% positive`
      : 'rating n/a';
  return (
    `Backfilled ${result.daysImported} day(s) of reviews ` +
    `(${result.rangeStart ?? '?'} → ${result.rangeEnd ?? '?'}) ` +
    `from ${result.reviewsFetched.toLocaleString()} fetched reviews. ` +
    `Latest ${result.latestTotal.toLocaleString()} reviews (${rating}). ` +
    `Rebuild estimates to apply.`
  );
}

export function BackfillReviewsButton({ gameId }: Props) {
  const [pending, start] = useTransition();

  function onClick() {
    if (
      !window.confirm(
        'Fetch the full review history from the Steam API? ' +
          'This can take several minutes for popular games.',
      )
    ) {
      return;
    }
    start(async () => {
      try {
        const result = await backfillReviews(gameId);
        window.alert(describeResult(result));
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
      <Download
        aria-hidden="true"
        className={`size-4 ${pending ? 'animate-pulse' : ''}`}
      />
      {pending ? 'Fetching…' : 'Backfill reviews (API)'}
    </Button>
  );
}
