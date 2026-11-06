'use client';

import { useState, useTransition } from 'react';
import { Pencil, X, Loader2, Lock, LockOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { ManualGameField } from '@/lib/admin';
import type { Platform } from '@/lib/api';
import { updateGame, type UpdateGamePayload } from '../actions';

// GLOBAL is a milestone scope, not a platform a game ships on.
const PLATFORMS: { value: Platform; label: string }[] = [
  { value: 'PC', label: 'PC' },
  { value: 'PLAYSTATION', label: 'PlayStation' },
  { value: 'XBOX', label: 'Xbox' },
  { value: 'SWITCH', label: 'Switch' },
  { value: 'MOBILE', label: 'Mobile' },
  { value: 'OTHER', label: 'Other' },
];

const FIELD_LABELS: Record<ManualGameField, string> = {
  name: 'Name',
  summary: 'Summary',
  releaseDate: 'Release date',
  coverUrl: 'Cover URL',
  developer: 'Developer',
  publisher: 'Publisher',
  platforms: 'Platforms',
  genres: 'Genres',
  categories: 'Steam categories',
  steamTags: 'Steam tags',
  isFree: 'Free-to-play',
  liveService: 'Live service',
};

export interface EditGameInitialValues {
  id: string;
  name: string;
  releaseDate: string | null;
  igdbId: number | null;
  summary: string | null;
  coverUrl: string | null;
  developer: string | null;
  publisher: string | null;
  platforms: Platform[];
  genres: string[];
  categories: string[];
  steamTags: string[];
  isFree: boolean;
  liveService: boolean;
  manualFields: ManualGameField[];
}

interface FormValues {
  name: string;
  releaseDate: string;
  igdbId: string;
  summary: string;
  coverUrl: string;
  developer: string;
  publisher: string;
  platforms: Platform[];
  genres: string;
  categories: string;
  steamTags: string;
  isFree: boolean;
  liveService: boolean;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

function toFormValues(initial: EditGameInitialValues): FormValues {
  return {
    name: initial.name,
    releaseDate: toDateInputValue(initial.releaseDate),
    igdbId: initial.igdbId?.toString() ?? '',
    summary: initial.summary ?? '',
    coverUrl: initial.coverUrl ?? '',
    developer: initial.developer ?? '',
    publisher: initial.publisher ?? '',
    platforms: initial.platforms.filter((p) => p !== 'GLOBAL'),
    genres: initial.genres.join(', '),
    categories: initial.categories.join(', '),
    steamTags: initial.steamTags.join(', '),
    isFree: initial.isFree,
    liveService: initial.liveService,
  };
}

function parseList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v !== ''),
    ),
  );
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Build the PATCH body from the fields that changed; returns an error string on invalid input. */
function buildPayload(
  initial: EditGameInitialValues,
  values: FormValues,
): UpdateGamePayload | string {
  const start = toFormValues(initial);
  const payload: UpdateGamePayload = {};

  const name = values.name.trim();
  if (name !== initial.name) {
    if (!name) return 'Name cannot be empty';
    payload.name = name;
  }

  if (values.releaseDate !== start.releaseDate) {
    payload.releaseDate = values.releaseDate || null;
  }

  const igdb = values.igdbId.trim();
  if (igdb !== start.igdbId) {
    if (!igdb) {
      payload.igdbId = null;
    } else {
      const parsed = Number(igdb);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return 'IGDB ID must be a positive integer';
      }
      payload.igdbId = parsed;
    }
  }

  for (const field of ['summary', 'developer', 'publisher'] as const) {
    const next = values[field].trim();
    if (next !== start[field].trim()) payload[field] = next || null;
  }

  const cover = values.coverUrl.trim();
  if (cover !== start.coverUrl) {
    if (cover && !isHttpUrl(cover)) return 'Cover URL must be an http(s) URL';
    payload.coverUrl = cover || null;
  }

  if (!sameList([...values.platforms].sort(), [...start.platforms].sort())) {
    if (values.platforms.length === 0) return 'Pick at least one platform';
    payload.platforms = PLATFORMS.map((p) => p.value).filter((p) =>
      values.platforms.includes(p),
    );
  }

  for (const field of ['genres', 'categories', 'steamTags'] as const) {
    const next = parseList(values[field]);
    if (!sameList(next, initial[field])) payload[field] = next;
  }

  if (values.isFree !== initial.isFree) payload.isFree = values.isFree;
  if (values.liveService !== initial.liveService) {
    payload.liveService = values.liveService;
  }

  return payload;
}

export function EditGameForm({ initial }: { initial: EditGameInitialValues }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<FormValues>(() => toFormValues(initial));
  const [unlock, setUnlock] = useState<ManualGameField[]>([]);

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  function open() {
    setValues(toFormValues(initial));
    setUnlock([]);
    setError(null);
    setIsOpen(true);
  }

  function togglePlatform(platform: Platform, checked: boolean) {
    set(
      'platforms',
      checked
        ? [...values.platforms, platform]
        : values.platforms.filter((p) => p !== platform),
    );
  }

  function toggleUnlock(field: ManualGameField) {
    setUnlock((u) =>
      u.includes(field) ? u.filter((f) => f !== field) : [...u, field],
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const payload = buildPayload(initial, values);
    if (typeof payload === 'string') {
      setError(payload);
      return;
    }
    if (unlock.length > 0) payload.unlock = unlock;
    if (Object.keys(payload).length === 0) {
      setIsOpen(false);
      return;
    }
    startTransition(async () => {
      try {
        await updateGame(initial.id, payload);
        setIsOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update game');
      }
    });
  }

  if (!isOpen) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={open}>
          <Pencil aria-hidden="true" className="size-4" />
          Edit metadata
        </Button>
        {initial.manualFields.length > 0 && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Lock aria-hidden="true" className="size-3" />
            Kept from crons:{' '}
            {initial.manualFields.map((f) => FIELD_LABELS[f]).join(', ')}
          </span>
        )}
      </div>
    );
  }

  const locked = new Set(initial.manualFields);
  const fieldLabel = (field: ManualGameField, htmlFor?: string) => (
    <Label htmlFor={htmlFor} className="flex items-center gap-1.5">
      {FIELD_LABELS[field]}
      {locked.has(field) && !unlock.includes(field) && (
        <Lock
          aria-label="Edited by hand, kept from crons"
          className="text-muted-foreground size-3"
        />
      )}
    </Label>
  );

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border bg-muted/40 flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          {fieldLabel('name', 'game-name')}
          <Input
            id="game-name"
            value={values.name}
            onChange={(e) => set('name', e.target.value)}
            disabled={isPending}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          {fieldLabel('releaseDate', 'game-release-date')}
          <Input
            id="game-release-date"
            type="date"
            min="1970-01-01"
            max="2100-12-31"
            value={values.releaseDate}
            onChange={(e) => set('releaseDate', e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="game-igdb-id">IGDB ID</Label>
          <Input
            id="game-igdb-id"
            type="number"
            min="1"
            value={values.igdbId}
            onChange={(e) => set('igdbId', e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className="flex items-end gap-4 pt-6">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.isFree}
                onChange={(e) => set('isFree', e.target.checked)}
                disabled={isPending}
              />
              {FIELD_LABELS.isFree}
              {locked.has('isFree') && !unlock.includes('isFree') && (
                <Lock aria-hidden="true" className="text-muted-foreground size-3" />
              )}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.liveService}
                onChange={(e) => set('liveService', e.target.checked)}
                disabled={isPending}
              />
              {FIELD_LABELS.liveService}
              {locked.has('liveService') && !unlock.includes('liveService') && (
                <Lock aria-hidden="true" className="text-muted-foreground size-3" />
              )}
            </label>
          </span>
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-3">
          {fieldLabel('summary', 'game-summary')}
          <Textarea
            id="game-summary"
            rows={4}
            maxLength={5000}
            value={values.summary}
            onChange={(e) => set('summary', e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          {fieldLabel('coverUrl', 'game-cover-url')}
          <Input
            id="game-cover-url"
            type="url"
            placeholder="https://…"
            value={values.coverUrl}
            onChange={(e) => set('coverUrl', e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex items-end">
          {isHttpUrl(values.coverUrl.trim()) && (
            // Admin-only preview of an arbitrary URL: next/image would need
            // the host in remotePatterns.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={values.coverUrl.trim()}
              alt="Cover preview"
              className="border-border h-16 rounded border object-cover"
            />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          {fieldLabel('developer', 'game-developer')}
          <Input
            id="game-developer"
            value={values.developer}
            onChange={(e) => set('developer', e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          {fieldLabel('publisher', 'game-publisher')}
          <Input
            id="game-publisher"
            value={values.publisher}
            onChange={(e) => set('publisher', e.target.value)}
            disabled={isPending}
          />
        </div>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5">{fieldLabel('platforms')}</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5">
            {PLATFORMS.map((p) => (
              <label key={p.value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={values.platforms.includes(p.value)}
                  onChange={(e) => togglePlatform(p.value, e.target.checked)}
                  disabled={isPending}
                />
                {p.label}
              </label>
            ))}
          </div>
        </fieldset>
        {(['genres', 'categories', 'steamTags'] as const).map((field) => (
          <div key={field} className="flex flex-col gap-1.5 sm:col-span-3">
            {fieldLabel(field, `game-${field}`)}
            <Input
              id={`game-${field}`}
              placeholder="Comma-separated"
              value={values[field]}
              onChange={(e) => set(field, e.target.value)}
              disabled={isPending}
            />
          </div>
        ))}
      </div>

      {initial.manualFields.length > 0 && (
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-muted-foreground">
            Edited by hand, kept from crons. Unlock a field to let the next
            Steam / IGDB pass overwrite it:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {initial.manualFields.map((field) => {
              const unlocking = unlock.includes(field);
              return (
                <Button
                  key={field}
                  type="button"
                  variant={unlocking ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={() => toggleUnlock(field)}
                  disabled={isPending}
                  aria-pressed={unlocking}
                >
                  {unlocking ? (
                    <LockOpen aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Lock aria-hidden="true" className="size-3.5" />
                  )}
                  {FIELD_LABELS[field]}
                  {unlocking && ' (unlock on save)'}
                </Button>
              );
            })}
          </div>
        </div>
      )}

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
          onClick={() => setIsOpen(false)}
          disabled={isPending}
        >
          <X aria-hidden="true" className="size-4" />
          Cancel
        </Button>
      </div>
    </form>
  );
}
