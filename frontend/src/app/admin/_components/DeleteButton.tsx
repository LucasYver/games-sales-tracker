'use client';

import { useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  action: () => Promise<void>;
  confirmMessage: string;
  label?: string;
  iconOnly?: boolean;
}

export function DeleteButton({
  action,
  confirmMessage,
  label = 'Delete',
  iconOnly,
}: Props) {
  const [pending, start] = useTransition();

  function onClick() {
    if (!confirm(confirmMessage)) return;
    start(async () => {
      try {
        await action();
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert(err instanceof Error ? err.message : 'Delete failed');
      }
    });
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size={iconOnly ? 'icon' : 'sm'}
      onClick={onClick}
      disabled={pending}
      aria-label={iconOnly ? label : undefined}
      className="text-destructive hover:text-destructive"
    >
      <Trash2 aria-hidden="true" className="size-4" />
      {!iconOnly && (pending ? 'Deleting…' : label)}
    </Button>
  );
}
