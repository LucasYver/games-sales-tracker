'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  updatePublisherLauncherProfile,
} from '../actions';
import type { LauncherProfile } from '@/lib/admin';

const PROFILES: Array<{ value: LauncherProfile; label: string }> = [
  { value: 'STEAM_DOMINANT', label: 'Steam-dominant (~90%+ PC on Steam)' },
  { value: 'MULTI_STORE', label: 'Multi-store (~40-70% PC on Steam)' },
  {
    value: 'LAUNCHER_PRIMARY',
    label: 'Launcher-primary (~10-25% PC on Steam)',
  },
];

interface Props {
  publisherId: string;
  current: LauncherProfile;
}

export function LauncherProfileSelect({ publisherId, current }: Props) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function onChange(next: LauncherProfile) {
    if (next === current) return;
    start(async () => {
      try {
        await updatePublisherLauncherProfile(publisherId, next);
        router.refresh();
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'Failed to update profile.',
        );
      }
    });
  }

  return (
    <Select
      value={current}
      onValueChange={(v) => onChange(v as LauncherProfile)}
      disabled={pending}
    >
      <SelectTrigger className="h-8 w-[260px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROFILES.map((p) => (
          <SelectItem key={p.value} value={p.value} className="text-xs">
            {p.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
