'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2 } from 'lucide-react';
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
import type {
  AdminGenreProfile,
  GenreConfidence,
  Year2Retention,
} from '@/lib/admin';
import { updateGenreProfile } from '../actions';

const CONFIDENCE_VALUES: GenreConfidence[] = ['LOW', 'MEDIUM', 'HIGH'];

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

interface Props {
  profile: AdminGenreProfile;
}

interface Draft {
  name: string;
  description: string;
  pcShare: number;
  playstationShare: number;
  xboxShare: number;
  switchShare: number;
  leanLabel: string;
  confidence: GenreConfidence;
  lifecycleIndex: number;
  firstWeekToYearOneMultiplier: number;
  year2Retention: Year2Retention;
  lifecycleDriver: string;
  peakCcuToWeekOneLow: number;
  peakCcuToWeekOneHigh: number;
  pcDefaultBoxleiterLow: number | null;
  pcDefaultBoxleiterHigh: number | null;
  psDefaultBoxleiterLow: number | null;
  psDefaultBoxleiterHigh: number | null;
}

function toDraft(profile: AdminGenreProfile): Draft {
  return {
    name: profile.name,
    description: profile.description ?? '',
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
    peakCcuToWeekOneLow: profile.peakCcuToWeekOneLow,
    peakCcuToWeekOneHigh: profile.peakCcuToWeekOneHigh,
    pcDefaultBoxleiterLow: profile.pcDefaultBoxleiterLow,
    pcDefaultBoxleiterHigh: profile.pcDefaultBoxleiterHigh,
    psDefaultBoxleiterLow: profile.psDefaultBoxleiterLow,
    psDefaultBoxleiterHigh: profile.psDefaultBoxleiterHigh,
  };
}

export function GenreProfileEditor({ profile }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const sum =
    draft.pcShare +
    draft.playstationShare +
    draft.xboxShare +
    draft.switchShare;
  const sumOk = Math.abs(sum - 1) <= 0.01;
  const ccuOk = draft.peakCcuToWeekOneLow <= draft.peakCcuToWeekOneHigh;
  const pcBoxleiterOk =
    draft.pcDefaultBoxleiterLow == null ||
    draft.pcDefaultBoxleiterHigh == null ||
    draft.pcDefaultBoxleiterLow <= draft.pcDefaultBoxleiterHigh;
  const psBoxleiterOk =
    draft.psDefaultBoxleiterLow == null ||
    draft.psDefaultBoxleiterHigh == null ||
    draft.psDefaultBoxleiterLow <= draft.psDefaultBoxleiterHigh;
  const nameOk = draft.name.trim().length > 0;

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(profile));
  const canSave =
    dirty && sumOk && ccuOk && pcBoxleiterOk && psBoxleiterOk && nameOk && !pending;

  function reset() {
    setDraft(toDraft(profile));
  }

  function save() {
    start(async () => {
      try {
        await updateGenreProfile(profile.id, {
          name: draft.name.trim(),
          description:
            draft.description.trim() === '' ? null : draft.description.trim(),
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
            draft.lifecycleDriver.trim() === ''
              ? null
              : draft.lifecycleDriver.trim(),
          peakCcuToWeekOneLow: draft.peakCcuToWeekOneLow,
          peakCcuToWeekOneHigh: draft.peakCcuToWeekOneHigh,
          pcDefaultBoxleiterLow: draft.pcDefaultBoxleiterLow,
          pcDefaultBoxleiterHigh: draft.pcDefaultBoxleiterHigh,
          psDefaultBoxleiterLow: draft.psDefaultBoxleiterLow,
          psDefaultBoxleiterHigh: draft.psDefaultBoxleiterHigh,
        });
        router.refresh();
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Update failed');
      }
    });
  }

  return (
    <div className="flex flex-col gap-8">
      <Section
        title="Identity"
        hint="Display name and free-form description shown in the admin."
      >
        <Field label="Name" className="sm:col-span-2">
          <Input
            value={draft.name}
            onChange={(e) => set('name', e.target.value)}
            className={nameOk ? '' : 'border-destructive'}
          />
        </Field>
        <Field
          label="Description"
          className="sm:col-span-3"
          hint="Optional. Why this bucket exists / how it behaves."
        >
          <textarea
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
            rows={2}
            className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
          />
        </Field>
      </Section>

      <Section
        title="Platform split"
        hint={
          <>
            PC / PS / Xbox / Switch share of total units. Must sum to ≈ 1.{' '}
            <span
              className={`font-mono tabular-nums ${sumOk ? 'text-muted-foreground' : 'text-destructive'}`}
            >
              Σ {sum.toFixed(3)}
            </span>
          </>
        }
      >
        <ShareField
          label="PC"
          value={draft.pcShare}
          onChange={(v) => set('pcShare', v)}
        />
        <ShareField
          label="PlayStation"
          value={draft.playstationShare}
          onChange={(v) => set('playstationShare', v)}
        />
        <ShareField
          label="Xbox"
          value={draft.xboxShare}
          onChange={(v) => set('xboxShare', v)}
        />
        <ShareField
          label="Switch"
          value={draft.switchShare}
          onChange={(v) => set('switchShare', v)}
        />
        <Field label="Lean" hint="Qualitative hint, e.g. “PS fort”.">
          <Input
            value={draft.leanLabel}
            onChange={(e) => set('leanLabel', e.target.value)}
            placeholder="e.g. équilibré"
          />
        </Field>
        <Field label="Confidence" hint="How strongly the split is trusted.">
          <Select
            value={draft.confidence}
            onValueChange={(v) => set('confidence', v as GenreConfidence)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONFIDENCE_VALUES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Section>

      <Section
        title="Lifecycle"
        hint="How the sales curve decays over time. Feeds the genre-aware first-week extrapolation."
      >
        <NumberField
          label="Lifecycle index"
          hint="Normalised empirical score (~0.4–2.5)."
          value={draft.lifecycleIndex}
          step={0.05}
          min={0}
          max={10}
          onChange={(v) => set('lifecycleIndex', v)}
        />
        <NumberField
          label="×Year-1 multiplier"
          hint="Year-1 cumulative units / week-1 units."
          value={draft.firstWeekToYearOneMultiplier}
          step={0.1}
          min={0}
          max={20}
          onChange={(v) => set('firstWeekToYearOneMultiplier', v)}
        />
        <Field
          label="Year-2 retention"
          hint="How much it still sells past year 1."
        >
          <Select
            value={draft.year2Retention}
            onValueChange={(v) => set('year2Retention', v as Year2Retention)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETENTION_VALUES.map((r) => (
                <SelectItem key={r} value={r}>
                  {RETENTION_LABEL[r]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Lifecycle driver"
          className="sm:col-span-3"
          hint="Free-text rationale (mods, UGC, DLC, live service…)."
        >
          <Input
            value={draft.lifecycleDriver}
            onChange={(e) => set('lifecycleDriver', e.target.value)}
            placeholder="e.g. Mods, MAJ continues"
          />
        </Field>
      </Section>

      <Section
        title="Peak CCU → week-1"
        hint="All-time peak Steam CCU → week-1 units ratio. High-engagement genres keep a large share online at once, so their ratio is low."
      >
        <NumberField
          label="Low"
          value={draft.peakCcuToWeekOneLow}
          step={0.1}
          min={0}
          max={50}
          invalid={!ccuOk}
          onChange={(v) => set('peakCcuToWeekOneLow', v)}
        />
        <NumberField
          label="High"
          value={draft.peakCcuToWeekOneHigh}
          step={0.1}
          min={0}
          max={50}
          invalid={!ccuOk}
          onChange={(v) => set('peakCcuToWeekOneHigh', v)}
        />
        {!ccuOk && (
          <p className="text-destructive sm:col-span-3 text-xs">
            Low must be ≤ high.
          </p>
        )}
      </Section>

      <Section
        title="Boxleiter defaults"
        hint="Per-genre Boxleiter multiplier range for uncalibrated games. Leave blank to use the global constant (PC 25–65, PS 40–100). Set based on the distribution of calibrated multipliers observed for this genre."
      >
        <NullableNumberField
          label="PC low"
          hint="Override PC_BOXLEITER_DEFAULT_LOW"
          value={draft.pcDefaultBoxleiterLow}
          step={1}
          min={1}
          max={500}
          invalid={!pcBoxleiterOk}
          onChange={(v) => set('pcDefaultBoxleiterLow', v)}
        />
        <NullableNumberField
          label="PC high"
          hint="Override PC_BOXLEITER_DEFAULT_HIGH"
          value={draft.pcDefaultBoxleiterHigh}
          step={1}
          min={1}
          max={500}
          invalid={!pcBoxleiterOk}
          onChange={(v) => set('pcDefaultBoxleiterHigh', v)}
        />
        {!pcBoxleiterOk && (
          <p className="text-destructive sm:col-span-3 text-xs">
            PC low must be ≤ PC high.
          </p>
        )}
        <NullableNumberField
          label="PS low"
          hint="Override PS_BOXLEITER_DEFAULT_LOW"
          value={draft.psDefaultBoxleiterLow}
          step={1}
          min={1}
          max={500}
          invalid={!psBoxleiterOk}
          onChange={(v) => set('psDefaultBoxleiterLow', v)}
        />
        <NullableNumberField
          label="PS high"
          hint="Override PS_BOXLEITER_DEFAULT_HIGH"
          value={draft.psDefaultBoxleiterHigh}
          step={1}
          min={1}
          max={500}
          invalid={!psBoxleiterOk}
          onChange={(v) => set('psDefaultBoxleiterHigh', v)}
        />
        {!psBoxleiterOk && (
          <p className="text-destructive sm:col-span-3 text-xs">
            PS low must be ≤ PS high.
          </p>
        )}
      </Section>

      <div className="flex items-center gap-2">
        <Button type="button" onClick={save} disabled={!canSave}>
          {pending ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Check aria-hidden="true" className="size-4" />
          )}
          Save changes
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={reset}
          disabled={!dirty || pending}
        >
          Reset
        </Button>
        {!sumOk && (
          <span className="text-destructive text-xs">
            Platform shares must sum to ≈ 1.
          </span>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold tracking-wide uppercase">
          {title}
        </h2>
        {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-[11px]">{hint}</p>}
    </div>
  );
}

function ShareField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <Field label={label} hint={`${(value * 100).toFixed(1)}%`}>
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
        className="text-right tabular-nums"
      />
    </Field>
  );
}

function NumberField({
  label,
  hint,
  value,
  step,
  min,
  max,
  invalid,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  step: number;
  min: number;
  max: number;
  invalid?: boolean;
  onChange: (next: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          onChange(Number.isFinite(parsed) ? parsed : 0);
        }}
        className={`text-right tabular-nums ${invalid ? 'border-destructive' : ''}`}
      />
    </Field>
  );
}

function NullableNumberField({
  label,
  hint,
  value,
  step,
  min,
  max,
  invalid,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number | null;
  step: number;
  min: number;
  max: number;
  invalid?: boolean;
  onChange: (next: number | null) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <Input
        type="number"
        step={step}
        min={min}
        max={max}
        placeholder="global"
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') {
            onChange(null);
          } else {
            const parsed = Number(raw);
            onChange(Number.isFinite(parsed) ? parsed : null);
          }
        }}
        className={`text-right tabular-nums ${invalid ? 'border-destructive' : ''}`}
      />
    </Field>
  );
}
