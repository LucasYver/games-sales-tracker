'use client';

import { useState, useTransition } from 'react';
import { Pencil, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { updateGame, type UpdateGamePayload } from '../actions';

interface InitialValues {
  id: string;
  name: string;
  releaseDate: string | null;
  igdbId: number | null;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
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

  function reset() {
    setName(initial.name);
    setReleaseDate(toDateInputValue(initial.releaseDate));
    setIgdbId(initial.igdbId?.toString() ?? '');
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
