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
import type { AdminGenreProfile } from '@/lib/admin';
import { setGameGenreProfile } from '../actions';

const AUTO_VALUE = '__auto__';

interface Props {
  gameId: string;
  currentProfileId: string | null;
  manual: boolean;
  profiles: AdminGenreProfile[];
}

export function GameGenreProfileSelect({
  gameId,
  currentProfileId,
  manual,
  profiles,
}: Props) {
  const [pending, start] = useTransition();
  const router = useRouter();

  const selectedValue = manual && currentProfileId ? currentProfileId : AUTO_VALUE;
  const resolvedProfileName =
    profiles.find((p) => p.id === currentProfileId)?.name ?? null;

  function onChange(next: string) {
    const nextId = next === AUTO_VALUE ? null : next;
    if (next === selectedValue) return;
    start(async () => {
      try {
        await setGameGenreProfile(gameId, nextId);
        router.refresh();
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'Failed to update profile.',
        );
      }
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <Select value={selectedValue} onValueChange={onChange} disabled={pending}>
        <SelectTrigger className="h-8 w-[260px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTO_VALUE} className="text-xs">
            Auto (from genres)
          </SelectItem>
          {profiles.map((p) => (
            <SelectItem key={p.id} value={p.id} className="text-xs">
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        {manual ? (
          <>Manual override</>
        ) : resolvedProfileName ? (
          <>Auto → {resolvedProfileName}</>
        ) : (
          <>Auto → no matching profile</>
        )}
      </p>
    </div>
  );
}
