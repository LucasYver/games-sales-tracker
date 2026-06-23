'use client';

import { useState, useTransition } from 'react';
import { Pencil, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SalesSource } from '@/lib/admin';
import { updateGame, type UpdateGamePayload } from '../actions';

interface InitialValues {
  id: string;
  name: string;
  releaseDate: string | null;
  igdbId: number | null;
  calibratedMultiplier: number | null;
  calibratedPsMultiplier: number | null;
  calibratedXboxMultiplier: number | null;
  calibrationSourcePc: SalesSource | null;
  calibrationSourcePs: SalesSource | null;
  calibrationSourceXbox: SalesSource | null;
}

const SOURCE_OPTIONS: SalesSource[] = [
  'OFFICIAL',
  'ANNOUNCEMENT',
  'WIKIPEDIA',
  'MEDIA',
];

const SOURCE_NONE = '__none__';

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

function toMultiplierInput(value: number | null): string {
  return value === null || value === undefined ? '' : String(value);
}

function parseMultiplier(value: string): {
  parsed: number | null;
  error: string | null;
} {
  const trimmed = value.trim();
  if (!trimmed) return { parsed: null, error: null };
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) {
    return { parsed: null, error: 'must be a positive number' };
  }
  return { parsed: num, error: null };
}

function diffCalibration(
  initialMultiplier: number | null,
  nextMultiplier: number | null,
  initialSource: SalesSource | null,
  nextSource: SalesSource | null,
): {
  multiplier?: number | null;
  source?: SalesSource | null;
  error?: string;
} {
  const result: {
    multiplier?: number | null;
    source?: SalesSource | null;
    error?: string;
  } = {};

  if (nextMultiplier !== initialMultiplier) result.multiplier = nextMultiplier;
  if (nextSource !== initialSource) result.source = nextSource;

  if (result.multiplier === undefined && result.source === undefined) {
    return {};
  }

  const effectiveMultiplier =
    result.multiplier === undefined ? initialMultiplier : result.multiplier;
  const effectiveSource =
    result.source === undefined ? initialSource : result.source;

  if (effectiveMultiplier !== null && effectiveSource === null) {
    return { error: 'a calibration source is required when the multiplier is set' };
  }

  if (effectiveMultiplier === null && effectiveSource !== null) {
    result.source = null;
  }

  return result;
}

export function EditGameForm({ initial }: { initial: InitialValues }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(initial.name);
  const [releaseDate, setReleaseDate] = useState(
    toDateInputValue(initial.releaseDate),
  );
  const [igdbId, setIgdbId] = useState(initial.igdbId?.toString() ?? '');

  const [pcMult, setPcMult] = useState(
    toMultiplierInput(initial.calibratedMultiplier),
  );
  const [psMult, setPsMult] = useState(
    toMultiplierInput(initial.calibratedPsMultiplier),
  );
  const [xboxMult, setXboxMult] = useState(
    toMultiplierInput(initial.calibratedXboxMultiplier),
  );
  const [pcSource, setPcSource] = useState<SalesSource | null>(
    initial.calibrationSourcePc,
  );
  const [psSource, setPsSource] = useState<SalesSource | null>(
    initial.calibrationSourcePs,
  );
  const [xboxSource, setXboxSource] = useState<SalesSource | null>(
    initial.calibrationSourceXbox,
  );

  function reset() {
    setName(initial.name);
    setReleaseDate(toDateInputValue(initial.releaseDate));
    setIgdbId(initial.igdbId?.toString() ?? '');
    setPcMult(toMultiplierInput(initial.calibratedMultiplier));
    setPsMult(toMultiplierInput(initial.calibratedPsMultiplier));
    setXboxMult(toMultiplierInput(initial.calibratedXboxMultiplier));
    setPcSource(initial.calibrationSourcePc);
    setPsSource(initial.calibrationSourcePs);
    setXboxSource(initial.calibrationSourceXbox);
    setError(null);
  }

  function handleCancel() {
    reset();
    setIsOpen(false);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const payload: UpdateGamePayload = {};
    const trimmedName = name.trim();
    if (trimmedName !== initial.name) {
      if (!trimmedName) {
        setError('Name cannot be empty');
        return;
      }
      payload.name = trimmedName;
    }

    const initialDate = toDateInputValue(initial.releaseDate);
    if (releaseDate !== initialDate) {
      payload.releaseDate = releaseDate || null;
    }

    const trimmedIgdb = igdbId.trim();
    const initialIgdb = initial.igdbId?.toString() ?? '';
    if (trimmedIgdb !== initialIgdb) {
      if (!trimmedIgdb) {
        payload.igdbId = null;
      } else {
        const parsed = Number(trimmedIgdb);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          setError('IGDB ID must be a positive integer');
          return;
        }
        payload.igdbId = parsed;
      }
    }

    const pcParsed = parseMultiplier(pcMult);
    if (pcParsed.error) {
      setError(`PC multiplier ${pcParsed.error}`);
      return;
    }
    const psParsed = parseMultiplier(psMult);
    if (psParsed.error) {
      setError(`PlayStation multiplier ${psParsed.error}`);
      return;
    }
    const xboxParsed = parseMultiplier(xboxMult);
    if (xboxParsed.error) {
      setError(`Xbox multiplier ${xboxParsed.error}`);
      return;
    }

    const pcDiff = diffCalibration(
      initial.calibratedMultiplier,
      pcParsed.parsed,
      initial.calibrationSourcePc,
      pcSource,
    );
    if (pcDiff.error) {
      setError(`PC ${pcDiff.error}`);
      return;
    }
    if (pcDiff.multiplier !== undefined) {
      payload.calibratedMultiplier = pcDiff.multiplier;
    }
    if (pcDiff.source !== undefined) {
      payload.calibrationSourcePc = pcDiff.source;
    }

    const psDiff = diffCalibration(
      initial.calibratedPsMultiplier,
      psParsed.parsed,
      initial.calibrationSourcePs,
      psSource,
    );
    if (psDiff.error) {
      setError(`PlayStation ${psDiff.error}`);
      return;
    }
    if (psDiff.multiplier !== undefined) {
      payload.calibratedPsMultiplier = psDiff.multiplier;
    }
    if (psDiff.source !== undefined) {
      payload.calibrationSourcePs = psDiff.source;
    }

    const xboxDiff = diffCalibration(
      initial.calibratedXboxMultiplier,
      xboxParsed.parsed,
      initial.calibrationSourceXbox,
      xboxSource,
    );
    if (xboxDiff.error) {
      setError(`Xbox ${xboxDiff.error}`);
      return;
    }
    if (xboxDiff.multiplier !== undefined) {
      payload.calibratedXboxMultiplier = xboxDiff.multiplier;
    }
    if (xboxDiff.source !== undefined) {
      payload.calibrationSourceXbox = xboxDiff.source;
    }

    if (Object.keys(payload).length === 0) {
      setIsOpen(false);
      return;
    }

    startTransition(async () => {
      try {
        await updateGame(initial.id, payload);
        setIsOpen(false);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update game';
        setError(message);
      }
    });
  }

  if (!isOpen) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
      >
        <Pencil aria-hidden="true" className="size-4" />
        Edit
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border bg-muted/40 flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          <Label htmlFor="game-name">Name</Label>
          <Input
            id="game-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="game-release-date">Release date</Label>
          <Input
            id="game-release-date"
            type="date"
            value={releaseDate}
            onChange={(e) => setReleaseDate(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="game-igdb-id">IGDB ID</Label>
          <Input
            id="game-igdb-id"
            type="number"
            min="1"
            value={igdbId}
            onChange={(e) => setIgdbId(e.target.value)}
            disabled={isPending}
          />
        </div>
      </div>

      <fieldset className="border-border flex flex-col gap-3 rounded-md border p-3">
        <legend className="text-muted-foreground px-1 text-xs font-semibold tracking-wide uppercase">
          Calibrated Boxleiter multipliers
        </legend>
        <p className="text-muted-foreground text-xs">
          Leave the multiplier empty to clear the calibration for a platform.
          When set, a calibration source is required.
        </p>
        <CalibrationRow
          label="PC"
          multiplierId="cal-pc-mult"
          sourceId="cal-pc-src"
          multiplier={pcMult}
          source={pcSource}
          onMultiplierChange={setPcMult}
          onSourceChange={setPcSource}
          disabled={isPending}
        />
        <CalibrationRow
          label="PlayStation"
          multiplierId="cal-ps-mult"
          sourceId="cal-ps-src"
          multiplier={psMult}
          source={psSource}
          onMultiplierChange={setPsMult}
          onSourceChange={setPsSource}
          disabled={isPending}
        />
        <CalibrationRow
          label="Xbox"
          multiplierId="cal-xbox-mult"
          sourceId="cal-xbox-src"
          multiplier={xboxMult}
          source={xboxSource}
          onMultiplierChange={setXboxMult}
          onSourceChange={setXboxSource}
          disabled={isPending}
        />
      </fieldset>

      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCancel}
          disabled={isPending}
        >
          <X aria-hidden="true" className="size-4" />
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CalibrationRow({
  label,
  multiplierId,
  sourceId,
  multiplier,
  source,
  onMultiplierChange,
  onSourceChange,
  disabled,
}: {
  label: string;
  multiplierId: string;
  sourceId: string;
  multiplier: string;
  source: SalesSource | null;
  onMultiplierChange: (value: string) => void;
  onSourceChange: (value: SalesSource | null) => void;
  disabled: boolean;
}) {
  return (
    <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[7rem_1fr_1fr]">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={multiplierId} className="text-xs">
          Multiplier
        </Label>
        <Input
          id={multiplierId}
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          placeholder="e.g. 1.25"
          value={multiplier}
          onChange={(e) => onMultiplierChange(e.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={sourceId} className="text-xs">
          Source
        </Label>
        <Select
          value={source ?? SOURCE_NONE}
          onValueChange={(value) =>
            onSourceChange(value === SOURCE_NONE ? null : (value as SalesSource))
          }
          disabled={disabled}
        >
          <SelectTrigger id={sourceId} className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SOURCE_NONE}>—</SelectItem>
            {SOURCE_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
