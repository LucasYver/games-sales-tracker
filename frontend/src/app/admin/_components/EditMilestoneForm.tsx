'use client';

import { useState, useTransition } from 'react';
import { Loader2, X } from 'lucide-react';
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
import type { AdminMilestone, SalesSource } from '@/lib/admin';
import type { Platform } from '@/lib/api';
import { updateMilestone, type UpdateMilestonePayload } from '../actions';

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

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

export function EditMilestoneForm({
  milestone,
  gameId,
  onClose,
}: {
  milestone: AdminMilestone;
  gameId: string;
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState<SalesSource>(milestone.source);
  const [platform, setPlatform] = useState<Platform>(
    milestone.platform as Platform,
  );
  const [units, setUnits] = useState(String(milestone.units));
  const [publisher, setPublisher] = useState(milestone.publisher ?? '');
  const [sourceUrl, setSourceUrl] = useState(milestone.sourceUrl ?? '');
  const [note, setNote] = useState(milestone.note ?? '');
  const [reportedAt, setReportedAt] = useState(
    toDateInputValue(milestone.reportedAt),
  );
  const [confidenceScore, setConfidenceScore] = useState(
    milestone.confidenceScore == null ? '' : String(milestone.confidenceScore),
  );
  const [isEngagement, setIsEngagement] = useState(milestone.isEngagement);
  const [isEstimate, setIsEstimate] = useState(milestone.isEstimate);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const payload: UpdateMilestonePayload = {};

    if (source !== milestone.source) payload.source = source;
    if (platform !== milestone.platform) payload.platform = platform;

    const trimmedUnits = units.trim();
    const parsedUnits = Number(trimmedUnits);
    if (!trimmedUnits || !Number.isInteger(parsedUnits) || parsedUnits <= 0) {
      setError('Units must be a positive integer');
      return;
    }
    if (parsedUnits !== milestone.units) payload.units = parsedUnits;

    const trimmedPublisher = publisher.trim();
    if (trimmedPublisher !== (milestone.publisher ?? '')) {
      payload.publisher = trimmedPublisher || null;
    }

    const trimmedUrl = sourceUrl.trim();
    if (trimmedUrl !== (milestone.sourceUrl ?? '')) {
      payload.sourceUrl = trimmedUrl || null;
    }

    const trimmedNote = note.trim();
    if (trimmedNote !== (milestone.note ?? '')) {
      payload.note = trimmedNote || null;
    }

    const initialDate = toDateInputValue(milestone.reportedAt);
    if (reportedAt !== initialDate) {
      payload.reportedAt = reportedAt || null;
    }

    const trimmedConfidence = confidenceScore.trim();
    const initialConfidence =
      milestone.confidenceScore == null ? '' : String(milestone.confidenceScore);
    if (trimmedConfidence !== initialConfidence) {
      if (!trimmedConfidence) {
        payload.confidenceScore = null;
      } else {
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
    }

    if (isEngagement !== milestone.isEngagement) {
      payload.isEngagement = isEngagement;
    }
    if (isEstimate !== milestone.isEstimate) {
      payload.isEstimate = isEstimate;
    }

    if (Object.keys(payload).length === 0) {
      onClose();
      return;
    }

    startTransition(async () => {
      try {
        await updateMilestone(milestone.id, gameId, payload);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update milestone');
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border bg-muted/40 flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ms-source-${milestone.id}`}>Source</Label>
          <Select
            value={source}
            onValueChange={(value) => setSource(value as SalesSource)}
            disabled={isPending}
          >
            <SelectTrigger id={`ms-source-${milestone.id}`} className="w-full">
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
          <Label htmlFor={`ms-platform-${milestone.id}`}>Platform</Label>
          <Select
            value={platform}
            onValueChange={(value) => setPlatform(value as Platform)}
            disabled={isPending}
          >
            <SelectTrigger id={`ms-platform-${milestone.id}`} className="w-full">
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
          <Label htmlFor={`ms-units-${milestone.id}`}>Units</Label>
          <Input
            id={`ms-units-${milestone.id}`}
            type="number"
            min="1"
            value={units}
            onChange={(e) => setUnits(e.target.value)}
            disabled={isPending}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ms-reported-${milestone.id}`}>Reported date</Label>
          <Input
            id={`ms-reported-${milestone.id}`}
            type="date"
            value={reportedAt}
            onChange={(e) => setReportedAt(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ms-publisher-${milestone.id}`}>Publisher / attribution</Label>
          <Input
            id={`ms-publisher-${milestone.id}`}
            value={publisher}
            onChange={(e) => setPublisher(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`ms-url-${milestone.id}`}>Source URL</Label>
          <Input
            id={`ms-url-${milestone.id}`}
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ms-confidence-${milestone.id}`}>Confidence (0-100)</Label>
          <Input
            id={`ms-confidence-${milestone.id}`}
            type="number"
            min="0"
            max="100"
            value={confidenceScore}
            onChange={(e) => setConfidenceScore(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-4">
          <Label htmlFor={`ms-note-${milestone.id}`}>Quote / note</Label>
          <Textarea
            id={`ms-note-${milestone.id}`}
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
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isPending}
        >
          <X aria-hidden="true" className="size-4" />
          Cancel
        </Button>
      </div>
    </form>
  );
}
