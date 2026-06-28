// Steam-share confidence thresholds, mirrored from the backend
// `launcherConfidenceCapFromShare` (sales-modeling.constants.ts).
const FULL_CONFIDENCE_PCT = 85;
const MEDIUM_CONFIDENCE_PCT = 35;

function formatPct(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

export function SteamShareBadge({
  low,
  high,
}: {
  low: number;
  high: number;
}) {
  const mid = (low + high) / 2;
  const { label, tone } =
    mid >= FULL_CONFIDENCE_PCT
      ? {
          label: 'Steam-dominant',
          tone: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
        }
      : mid >= MEDIUM_CONFIDENCE_PCT
        ? {
            label: 'Multi-store',
            tone: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
          }
        : {
            label: 'Launcher-primary',
            tone: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100',
          };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${tone}`}
    >
      {label}
      <span className="font-mono opacity-80">
        ({formatPct(low)}–{formatPct(high)}% Steam)
      </span>
    </span>
  );
}
