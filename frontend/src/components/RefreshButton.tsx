'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { refreshGameSources } from '@/lib/api';
import { Button } from '@/components/ui/button';

type Status = { kind: 'idle' | 'success' | 'error'; message: string };

export function RefreshButton({ gameId }: { gameId: string }) {
  const router = useRouter();
  const t = useTranslations('refreshButton');
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle', message: '' });

  async function handleRefresh() {
    setBusy(true);
    setStatus({ kind: 'idle', message: '' });
    try {
      const result = await refreshGameSources(gameId);
      setStatus({
        kind: 'success',
        message:
          result.articlesIngested > 0
            ? t('successWithArticles', { count: result.articlesIngested })
            : t('successEmpty'),
      });
      startTransition(() => router.refresh());
    } catch {
      setStatus({ kind: 'error', message: t('error') });
    } finally {
      setBusy(false);
    }
  }

  const working = busy || isPending;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleRefresh}
        disabled={working}
      >
        <RefreshCw
          aria-hidden="true"
          className={working ? 'size-4 animate-spin' : 'size-4'}
        />
        {working ? t('refreshing') : t('label')}
      </Button>
      {status.kind !== 'idle' && (
        <p
          role="status"
          className={
            status.kind === 'success'
              ? 'text-xs text-emerald-600'
              : 'text-xs text-rose-600'
          }
        >
          {status.message}
        </p>
      )}
    </div>
  );
}
