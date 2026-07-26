'use client';

import { useState, useTransition } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SalesSource } from '@/lib/admin';
import type { Platform } from '@/lib/api';
import { createMilestone, type CreateMilestonePayload } from '../actions';

const SOURCE_OPTIONS: SalesSource[] = [
  'OFFICIAL',
  'WIKIPEDIA',
  'ANNOUNCEMENT',
  'MEDIA',
  'STEAM_LEAK',
];

const PLATFORM_OPTIONS: Platform[] = [
  'GLOBAL',
  'PC',
  'PLAYSTATION',
  'XBOX',
  'SWITCH',
  'MOBILE',
  'OTHER',
];

export function AddMilestoneForm({ gameId }: { gameId: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<SalesSource>('OFFICIAL');
  const [platform, setPlatform] = useState<Platform>('GLOBAL');
  const [units, setUnits] = useState('');
  const [publisher, setPublisher] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [note, setNote] = useState('');
  const [reportedAt, setReportedAt] = useState('');
  const [confidenceScore, setConfidenceScore] = useState('');
  const [isEngagement, setIsEngagement] = useState(false);
  const [isEstimate, setIsEstimate] = useState(false);

  function reset() {
    setSource('OFFICIAL');
    setPlatform('GLOBAL');
    setUnits('');
    setPublisher('');
    setSourceUrl('');
    setNote('');
    setReportedAt('');
    setConfidenceScore('');
    setIsEngagement(false);
    setIsEstimate(false);
    setError(null);
  }

  function close() {
    reset();
    setIsOpen(false);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedUnits = units.trim();
    const parsedUnits = Number(trimmedUnits);
    if (!trimmedUnits || !Number.isInteger(parsedUnits) || parsedUnits <= 0) {
      setError('Units must be a positive integer');
      return;
    }

    if (!reportedAt) {
      setError('Reported date is required');
      return;
    }

    const payload: CreateMilestonePayload = {
      source,
      units: parsedUnits,
      reportedAt,
      platform,
      isEngagement,
      isEstimate,
    };

    const trimmedPublisher = publisher.trim();
    if (trimmedPublisher) payload.publisher = trimmedPublisher;

    const trimmedUrl = sourceUrl.trim();
    if (trimmedUrl) payload.sourceUrl = trimmedUrl;

    const trimmedNote = note.trim();
    if (trimmedNote) payload.note = trimmedNote;

    const trimmedConfidence = confidenceScore.trim();
    if (trimmedConfidence) {
      const parsedConfidence = Number(trimmedConfidence);
      if (
        !Number.isInteger(parsedConfidence) ||
        parsedConfidence < 0 ||
        parsedConfidence > 100
      ) {
        setError('Confidence must be an integer between 0 and 100');
        return;
      }
      payload.confidenceScore = parsedConfidence;
    }

    startTransition(async () => {
      try {
        await createMilestone(gameId, payload);
        close();
      } catch (err) {
        setError(
          err instanceof Error ? err.message : 'Failed to create milestone',
        );
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
        <Plus aria-hidden="true" className="size-4" />
        Add milestone
      </Button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border bg-muted/40 flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-ms-source">Source</Label>
          <Select
            value={source}
            onValueChange={(value) => setSource(value as SalesSource)}
            disabled={isPending}
          >
            <SelectTrigger id="add-ms-source" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-ms-platform">Platform</Label>
          <Select
            value={platform}
            onValueChange={(value) => setPlatform(value as Platform)}
            disabled={isPending}
          >
            <SelectTrigger id="add-ms-platform" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLATFORM_OPTIONS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-ms-units">Units</Label>
          <Input
            id="add-ms-units"
            type="number"
            min="1"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            disabled={isPending}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-ms-reported">Reported date</Label>
          <Input
            id="add-ms-reported"
            type="date"
            value={reportedAt}
            onChange={(e) => setReportedAt(e.target.value)}
            disabled={isPending}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-ms-publisher">Publisher / attribution</Label>
          <Input
            id="add-ms-publisher"
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="add-ms-url">Source URL</Label>
          <Input
            id="add-ms-url"
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="add-ms-confidence">Confidence (0-100)</Label>
          <Input
            id="add-ms-confidence"
            type="number"
            min="0"
            max="100"
            placeholder="Auto"
            value={confidenceScore}
            onChange={(e) => setConfidenceScore(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-4">
          <Label htmlFor="add-ms-note">Quote / note</Label>
          <Textarea
            id="add-ms-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={isPending}
            rows={2}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={isEngagement}
            onCheckedChange={(checked) => setIsEngagement(checked === true)}
            disabled={isPending}
          />
          Engagement (players reached, not copies sold)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={isEstimate}
            onCheckedChange={(checked) => setIsEstimate(checked === true)}
            disabled={isPending}
          />
          Modeled estimate (not a sourced actual)
        </label>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
          Create
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={close}
          disabled={isPending}
        >
          <X aria-hidden="true" className="size-4" />
          Cancel
        </Button>
      </div>
    </form>
  );
}
