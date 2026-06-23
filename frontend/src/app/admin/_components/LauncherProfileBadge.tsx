import type { LauncherProfile } from '@/lib/admin';

const LABELS: Record<LauncherProfile, string> = {
  STEAM_DOMINANT: 'Steam-dominant',
  MULTI_STORE: 'Multi-store',
  LAUNCHER_PRIMARY: 'Launcher-primary',
};

const TONES: Record<LauncherProfile, string> = {
  STEAM_DOMINANT: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100',
  MULTI_STORE: 'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100',
  LAUNCHER_PRIMARY: 'bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100',
};

export function LauncherProfileBadge({ profile }: { profile: LauncherProfile }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${TONES[profile]}`}
    >
      {LABELS[profile]}
    </span>
  );
}
