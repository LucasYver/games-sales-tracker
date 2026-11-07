'use client';

import { useState, useTransition } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runCron } from '../actions';

interface Props {
  name: string;
  /** The backend instance that answered the list is already running it. */
  running?: boolean;
}

export function RunCronButton({ name, running = false }: Props) {
  const [pending, start] = useTransition();
  const [started, setStarted] = useState(running);

  function onClick() {
    const confirmed = window.confirm(
      `Run /api/cron/${name} now? It runs in the background for up to 11 minutes, the same work as a scheduled run.`,
    );
    if (!confirmed) return;

    start(async () => {
      const result = await runCron(name);
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      setStarted(true);
      window.alert(
        `${name} started. Reload this page to follow its progress; the run's summary is in the backend logs.`,
      );
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending || started}
      aria-label={`Run ${name} now`}
    >
      <Play
        aria-hidden="true"
        className={`size-4 ${pending ? 'animate-pulse' : ''}`}
      />
      {pending ? 'Starting…' : started ? 'Running' : 'Run'}
    </Button>
  );
}
