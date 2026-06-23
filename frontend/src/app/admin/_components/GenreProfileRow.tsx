'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TableCell, TableRow } from '@/components/ui/table';
import type {
  AdminGenreProfile,
  GenreConfidence,
  Year2Retention,
} from '@/lib/admin';
import { updateGenreProfile } from '../actions';

const CONFIDENCE_VALUES: GenreConfidence[] = ['LOW', 'MEDIUM', 'HIGH'];

const CONFIDENCE_VARIANT: Record<
  GenreConfidence,
  'default' | 'secondary' | 'outline'
> = {
  HIGH: 'default',
  MEDIUM: 'secondary',
  LOW: 'outline',
};

const RETENTION_VALUES: Year2Retention[] = [
  'NEGATIVE',
  'VERY_LOW',
  'LOW',
  'LOW_MEDIUM',
  'MEDIUM',
  'MEDIUM_HIGH',
  'HIGH',
  'VERY_HIGH',
];

const RETENTION_LABEL: Record<Year2Retention, string> = {
  NEGATIVE: 'Negative',
  VERY_LOW: 'Very low',
  LOW: 'Low',
  LOW_MEDIUM: 'Low-medium',
  MEDIUM: 'Medium',
  MEDIUM_HIGH: 'Medium-high',
  HIGH: 'High',
  VERY_HIGH: 'Very high',
};

const RETENTION_VARIANT: Record<
  Year2Retention,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  NEGATIVE: 'destructive',
  VERY_LOW: 'outline',
  LOW: 'outline',
  LOW_MEDIUM: 'secondary',
  MEDIUM: 'secondary',
  MEDIUM_HIGH: 'default',
  HIGH: 'default',
  VERY_HIGH: 'default',
};

interface Props {
  profile: AdminGenreProfile;
}

export function GenreProfileRow({ profile }: Props) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const [draft, setDraft] = useState({
    pcShare: profile.pcShare,
    playstationShare: profile.playstationShare,
    xboxShare: profile.xboxShare,
    switchShare: profile.switchShare,
    leanLabel: profile.leanLabel ?? '',
    confidence: profile.confidence,
    lifecycleIndex: profile.lifecycleIndex,
    firstWeekToYearOneMultiplier: profile.firstWeekToYearOneMultiplier,
    year2Retention: profile.year2Retention,
    lifecycleDriver: profile.lifecycleDriver ?? '',
  });

  const sum =
    draft.pcShare +
    draft.playstationShare +
    draft.xboxShare +
    draft.switchShare;
  const sumOk = Math.abs(sum - 1) <= 0.01;

  function reset() {
    setDraft({
      pcShare: profile.pcShare,
      playstationShare: profile.playstationShare,
      xboxShare: profile.xboxShare,
      switchShare: profile.switchShare,
      leanLabel: profile.leanLabel ?? '',
      confidence: profile.confidence,
      lifecycleIndex: profile.lifecycleIndex,
      firstWeekToYearOneMultiplier: profile.firstWeekToYearOneMultiplier,
      year2Retention: profile.year2Retention,
      lifecycleDriver: profile.lifecycleDriver ?? '',
    });
    setEditing(false);
  }

  function save() {
    start(async () => {
      try {
        await updateGenreProfile(profile.id, {
          pcShare: draft.pcShare,
          playstationShare: draft.playstationShare,
          xboxShare: draft.xboxShare,
          switchShare: draft.switchShare,
          leanLabel: draft.leanLabel.trim() === '' ? null : draft.leanLabel,
          confidence: draft.confidence,
          lifecycleIndex: draft.lifecycleIndex,
          firstWeekToYearOneMultiplier: draft.firstWeekToYearOneMultiplier,
          year2Retention: draft.year2Retention,
          lifecycleDriver:
            draft.lifecycleDriver.trim() === '' ? null : draft.lifecycleDriver,
        });
        setEditing(false);
        router.refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Update failed');
      }
    });
  }

  if (!editing) {
    return (
      <TableRow>
        <TableCell className="font-medium">
          <div>{profile.name}</div>
          <div className="text-muted-foreground font-mono text-[10px]">
            {profile.slug}
          </div>
        </TableCell>
        <ShareCell value={profile.pcShare} />
        <ShareCell value={profile.playstationShare} />
        <ShareCell value={profile.xboxShare} />
        <ShareCell value={profile.switchShare} />
        <TableCell className="text-muted-foreground text-xs">
          {profile.leanLabel ?? '—'}
        </TableCell>
        <TableCell>
          <Badge variant={CONFIDENCE_VARIANT[profile.confidence]}>
            {profile.confidence}
          </Badge>
        </TableCell>
        <TableCell className="text-right text-xs tabular-nums">
          {profile.lifecycleIndex.toFixed(2)}
        </TableCell>
        <TableCell className="text-right text-xs tabular-nums">
          ×{profile.firstWeekToYearOneMultiplier.toFixed(2)}
        </TableCell>
        <TableCell>
          <Badge variant={RETENTION_VARIANT[profile.year2Retention]}>
            {RETENTION_LABEL[profile.year2Retention]}
          </Badge>
        </TableCell>
        <TableCell
          className="text-muted-foreground max-w-xs truncate text-xs"
          title={profile.lifecycleDriver ?? undefined}
        >
          {profile.lifecycleDriver ?? '—'}
        </TableCell>
        <TableCell className="text-right tabular-nums">
          {profile.genreCount}
        </TableCell>
        <TableCell className="text-right">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
          >
            <Pencil aria-hidden="true" className="size-3" />
            Edit
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow className="bg-muted/30">
      <TableCell className="font-medium">
        <div>{profile.name}</div>
        <div className="text-muted-foreground font-mono text-[10px]">
          {profile.slug}
        </div>
      </TableCell>
      <ShareInputCell
        value={draft.pcShare}
        onChange={(v) => setDraft((d) => ({ ...d, pcShare: v }))}
      />
      <ShareInputCell
        value={draft.playstationShare}
        onChange={(v) => setDraft((d) => ({ ...d, playstationShare: v }))}
      />
      <ShareInputCell
        value={draft.xboxShare}
        onChange={(v) => setDraft((d) => ({ ...d, xboxShare: v }))}
      />
      <ShareInputCell
        value={draft.switchShare}
        onChange={(v) => setDraft((d) => ({ ...d, switchShare: v }))}
      />
      <TableCell>
        <Input
          value={draft.leanLabel}
          onChange={(e) =>
            setDraft((d) => ({ ...d, leanLabel: e.target.value }))
          }
          placeholder="e.g. PS fort"
          className="h-8 w-24 text-xs"
        />
      </TableCell>
      <TableCell>
        <Select
          value={draft.confidence}
          onValueChange={(v) =>
            setDraft((d) => ({ ...d, confidence: v as GenreConfidence }))
          }
        >
          <SelectTrigger className="h-8 w-24 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONFIDENCE_VALUES.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.05"
          min={0}
          max={10}
          value={draft.lifecycleIndex}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            setDraft((d) => ({
              ...d,
              lifecycleIndex: Number.isFinite(parsed) ? parsed : 0,
            }));
          }}
          className="h-8 w-20 text-right text-xs tabular-nums"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          step="0.1"
          min={0}
          max={20}
          value={draft.firstWeekToYearOneMultiplier}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            setDraft((d) => ({
              ...d,
              firstWeekToYearOneMultiplier: Number.isFinite(parsed) ? parsed : 0,
            }));
          }}
          className="h-8 w-20 text-right text-xs tabular-nums"
        />
      </TableCell>
      <TableCell>
        <Select
          value={draft.year2Retention}
          onValueChange={(v) =>
            setDraft((d) => ({ ...d, year2Retention: v as Year2Retention }))
          }
        >
          <SelectTrigger className="h-8 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RETENTION_VALUES.map((r) => (
              <SelectItem key={r} value={r} className="text-xs">
                {RETENTION_LABEL[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          value={draft.lifecycleDriver}
          onChange={(e) =>
            setDraft((d) => ({ ...d, lifecycleDriver: e.target.value }))
          }
          placeholder="e.g. Mods, MAJ continues"
          className="h-8 w-48 text-xs"
        />
      </TableCell>
      <TableCell
        className={`text-right text-xs tabular-nums ${sumOk ? 'text-muted-foreground' : 'text-destructive'}`}
        title="Sum of all four shares (must be ≈ 1)"
      >
        Σ {sum.toFixed(3)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={save}
            disabled={pending || !sumOk}
          >
            {pending ? (
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
            ) : (
              <Check aria-hidden="true" className="size-3" />
            )}
            Save
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={pending}
          >
            <X aria-hidden="true" className="size-3" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ShareCell({ value }: { value: number }) {
  return (
    <TableCell className="text-right tabular-nums">
      {(value * 100).toFixed(1)}%
    </TableCell>
  );
}

function ShareInputCell({
  value,
  onChange,
}: {
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <TableCell>
      <Input
        type="number"
        step="0.001"
        min={0}
        max={1}
        value={value}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        className="h-8 w-20 text-right text-xs tabular-nums"
      />
    </TableCell>
  );
}
