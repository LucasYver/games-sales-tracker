'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  action: () => Promise<void>;
  confirmMessage: string;
  label?: string;
  iconOnly?: boolean;
}

const ARM_TIMEOUT_MS = 4000;

/**
 * Two-click delete: the first click arms the button, the second runs the
 * action. Avoids `window.confirm`, which browsers can silently suppress
 * (returning false), turning the button into a no-op.
 */
export function DeleteButton({
  action,
  confirmMessage,
  label = 'Delete',
  iconOnly,
}: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  function onClick() {
    if (!armed) {
      setError(null);
      setArmed(true);
      return;
    }
    setArmed(false);
    start(async () => {
      try {
        await action();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Delete failed');
      }
    });
  }

  const Icon = armed ? Check : Trash2;
  const text = pending ? 'Deleting…' : armed ? 'Confirm?' : label;

  return (
    <span className="inline-flex items-center gap-1">
      <Button
        type="button"
        variant={armed ? 'destructive' : 'ghost'}
        size={iconOnly ? 'icon' : 'sm'}
        onClick={onClick}
        disabled={pending}
        aria-label={iconOnly ? (armed ? `Confirm: ${confirmMessage}` : label) : undefined}
        title={armed ? `${confirmMessage} Click again to confirm.` : label}
        className={armed ? undefined : 'text-destructive hover:text-destructive'}
      >
        <Icon aria-hidden="true" className="size-4" />
        {!iconOnly && text}
      </Button>
      {error && (
        <span role="alert" className="text-destructive max-w-[200px] truncate text-xs" title={error}>
          {error}
        </span>
      )}
    </span>
  );
}
