import {
  adminFetch,
  type AdminEstimateBreakdown,
  type BoxleiterBreakdownEntry,
  type FirstWeekBreakdownEntry,
  type PlatformBreakdownResult,
} from '@/lib/admin';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return n.toLocaleString();
}

function fmtRange(low: number, high: number): string {
  return `${fmt(low)} – ${fmt(high)}`;
}

function fmtMultiplierRange(low: number, high: number): string {
  if (Math.abs(low - high) < 0.1) return `×${low.toFixed(1)}`;
  return `×${low.toFixed(1)}–${high.toFixed(1)}`;
}

function BoxleiterRow({ entry }: { entry: BoxleiterBreakdownEntry }) {
  return (
    <div className="border-border bg-background space-y-1.5 rounded border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground font-mono text-[11px]">
          {entry.method}
        </span>
        <span className="font-semibold tabular-nums">
          {fmtRange(entry.finalLow, entry.finalHigh)}
        </span>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5">
        <span>{entry.signal.metric}</span>
        <span className="text-foreground font-mono tabular-nums">
          {entry.signal.value.toLocaleString()}
        </span>
        <span>×</span>
        <span className="font-mono font-medium text-amber-700 dark:text-amber-400">
          {fmtMultiplierRange(entry.multiplierLow, entry.multiplierHigh)}
          {' (default)'}
        </span>
        {entry.calibratedValue != null && (
          <span className="text-muted-foreground/60 font-mono text-[10px]">
            calibrated ×{entry.calibratedValue.toFixed(2)}
          </span>
        )}
        <span>=</span>
        <span className="text-foreground font-mono tabular-nums">
          {fmtRange(entry.rawLow, entry.rawHigh)}
        </span>
      </div>
    </div>
  );
}

function FirstWeekRow({ entry }: { entry: FirstWeekBreakdownEntry }) {
  return (
    <div className="border-border bg-background space-y-1.5 rounded border p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground font-mono text-[11px]">
          {entry.method}
        </span>
        <span className="font-semibold tabular-nums">
          {fmtRange(entry.finalLow, entry.finalHigh)}
        </span>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5">
        <span>launch peak CCU</span>
        <span className="text-foreground font-mono tabular-nums">
          {entry.launchPeakValue.toLocaleString()}
        </span>
        <span>
          × [{entry.ccuRatioLow}, {entry.ccuRatioHigh}]
        </span>
        <span>=</span>
        <span className="text-foreground font-mono tabular-nums">
          week-1 {fmtRange(entry.weekOneFinalLow, entry.weekOneFinalHigh)}
        </span>
      </div>

      {entry.reviewsAtLaunch != null && (
        <div className="text-muted-foreground flex items-center gap-1">
          <span>+ reviews at launch</span>
          <span className="text-foreground font-mono tabular-nums">
            {entry.reviewsAtLaunch.toLocaleString()}
          </span>
          <span>(blended week-1)</span>
        </div>
      )}

      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5">
        <span>age {entry.ageDays}d</span>
        <span>× projection</span>
        <span className="text-foreground font-mono">
          ×{entry.projectionMultiplier.toFixed(2)}
        </span>
        {entry.m1 != null && (
          <span className="text-[10px]">(m1={entry.m1.toFixed(2)})</span>
        )}
        <span>=</span>
        <span className="text-foreground font-mono tabular-nums">
          {fmtRange(entry.finalLow, entry.finalHigh)}
        </span>
      </div>
    </div>
  );
}

function PlatformSection({ p }: { p: PlatformBreakdownResult }) {
  const highDisagreement = p.disagreement > 1;

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2 border-b pb-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{p.platform}</Badge>
          <span
            className={cn(
              'rounded border px-1 py-0.5 font-mono text-xs tabular-nums',
              highDisagreement
                ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : 'border-transparent text-muted-foreground',
            )}
          >
            disagree {(p.disagreement * 100).toFixed(0)}%
          </span>
        </div>
        <span className="text-sm font-semibold tabular-nums">
          {fmtRange(p.aggregateLow, p.aggregateHigh)}
        </span>
      </div>

      <div className="space-y-2 pl-2">
        {p.entries.map((entry, i) =>
          entry.type === 'boxleiter' ? (
            <BoxleiterRow key={i} entry={entry} />
          ) : (
            <FirstWeekRow key={i} entry={entry} />
          ),
        )}
      </div>

      <div
        className={cn(
          'ml-2 rounded border px-3 py-2 font-mono text-xs tabular-nums',
          highDisagreement
            ? 'border-amber-300 bg-amber-50/50 text-amber-800 dark:border-amber-700 dark:bg-amber-900/10 dark:text-amber-300'
            : 'border-border text-muted-foreground',
        )}
      >
        weighted avg {fmtRange(p.weightedLow, p.weightedHigh)} → inflate +
        {(p.inflate * 100).toFixed(0)}% →{' '}
        <span className="text-foreground font-semibold">
          {fmtRange(p.aggregateLow, p.aggregateHigh)}
        </span>
      </div>
    </section>
  );
}

export async function EstimateBreakdownPanel({ gameId }: { gameId: string }) {
  let breakdown: AdminEstimateBreakdown;
  try {
    breakdown = await adminFetch<AdminEstimateBreakdown>(
      `/games/${gameId}/estimate-breakdown`,
    );
  } catch {
    return null;
  }

  const { platforms, pureTotal, declared } = breakdown;
  if (platforms.length === 0) return null;

  const ratio =
    pureTotal && declared ? pureTotal.high / declared.units : null;
  const ratioTone =
    ratio == null
      ? ''
      : ratio > 3
        ? 'text-red-600 dark:text-red-400'
        : ratio > 1.5
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-emerald-600 dark:text-emerald-400';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-semibold tracking-wide uppercase">
          Pure algo breakdown
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          Default multipliers only · no declared figures · re-computed on demand
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {platforms.map((p) => (
          <PlatformSection key={p.platform} p={p} />
        ))}

        {(pureTotal ?? declared) && (
          <div className="space-y-1 border-t pt-4">
            <p className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
              Pure total vs declared
            </p>
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
              {pureTotal && (
                <span className="tabular-nums">
                  pure{' '}
                  <span className="font-semibold">
                    {fmtRange(pureTotal.low, pureTotal.high)}
                  </span>
                </span>
              )}
              {declared && (
                <span className="text-muted-foreground tabular-nums">
                  declared{' '}
                  <span className="text-foreground font-medium">
                    {fmt(declared.units)}
                  </span>{' '}
                  ({declared.source})
                </span>
              )}
              {ratio != null && (
                <span className={cn('font-semibold tabular-nums', ratioTone)}>
                  ratio ×{ratio.toFixed(2)}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
