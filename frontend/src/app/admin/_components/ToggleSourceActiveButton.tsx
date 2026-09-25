'use client';

import { useTransition } from 'react';
import { Power, PowerOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  action: () => Promise<void>;
  active: boolean;
  name: string;
}

export function ToggleSourceActiveButton({ action, active, name }: Props) {
  const [pending, start] = useTransition();

  function onClick() {
    const confirmMessage = active
      ? `Deactivate trusted source "${name}"? Inactive hosts are skipped by Perplexity and RSS ingest.`
      : `Reactivate trusted source "${name}"?`;
    if (!confirm(confirmMessage)) return;
    start(async () => {
      try {
        await action();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Update failed');
      }
    });
  }

  const label = active ? `Deactivate ${name}` : `Reactivate ${name}`;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={pending}
      aria-label={label}
    >
      {active ? (
        <PowerOff aria-hidden="true" className="size-4" />
      ) : (
        <Power aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
}
