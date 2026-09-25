'use client';

import { useTransition } from 'react';
import { Eraser } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  action: () => Promise<{ rejected: number }>;
  name: string;
  recordCount: number;
}

export function ClearSourceMilestonesButton({
  action,
  name,
  recordCount,
}: Props) {
  const [pending, start] = useTransition();

  function onClick() {
    const countLabel = recordCount.toLocaleString();
    const first = window.confirm(
      `Reject all ${countLabel} milestone(s) linked to "${name}"?\n\nThey will be hidden from estimates and blocked from being re-ingested.`,
    );
    if (!first) return;

    const typed = window.prompt(
      `Type the source name to confirm deletion of ${countLabel} milestone(s):\n\n${name}`,
    );
    if (typed === null) return;
    if (typed !== name) {
      window.alert('Name did not match. No milestones were deleted.');
      return;
    }

    start(async () => {
      try {
        const result = await action();
        window.alert(
          `Rejected ${result.rejected.toLocaleString()} milestone(s) from "${name}".`,
        );
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Clear failed');
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={pending || recordCount === 0}
      aria-label={`Clear ${recordCount} milestones from ${name}`}
      className="text-destructive hover:text-destructive"
    >
      <Eraser aria-hidden="true" className="size-4" />
    </Button>
  );
}
