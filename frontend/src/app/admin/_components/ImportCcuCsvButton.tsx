'use client';

import { useRef, useTransition } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { importCcuCsv, type ImportCcuCsvResult } from '../actions';

interface Props {
  gameId: string;
}

function describeResult(result: ImportCcuCsvResult): string {
  return (
    `Imported ${result.daysImported} day(s) of CCU ` +
    `(${result.rangeStart ?? '?'} → ${result.rangeEnd ?? '?'}) ` +
    `from ${result.rowsParsed} rows. ` +
    `Peak ${result.peakValue.toLocaleString()} CCU. ` +
    `Rebuild estimates to apply.`
  );
}

export function ImportCcuCsvButton({ gameId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();

  function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so selecting the same file again re-triggers onChange.
    event.target.value = '';
    if (!file) return;
    start(async () => {
      try {
        const csv = await file.text();
        const result = await importCcuCsv(gameId, csv);
        window.alert(describeResult(result));
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Import failed');
      }
    });
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={onFile}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
      >
        <Upload
          aria-hidden="true"
          className={`size-4 ${pending ? 'animate-pulse' : ''}`}
        />
        {pending ? 'Importing…' : 'Import CCU CSV'}
      </Button>
    </>
  );
}
