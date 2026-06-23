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
import { updateGenreProfileAssignment } from '../actions';

const UNASSIGNED_VALUE = '__unassigned__';

interface Props {
  genreId: string;
  currentProfileId: string | null;
  profiles: AdminGenreProfile[];
}

export function GenreAssignmentSelect({
  genreId,
  currentProfileId,
  profiles,
}: Props) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function onChange(next: string) {
    const nextId = next === UNASSIGNED_VALUE ? null : next;
    if (nextId === currentProfileId) return;
    start(async () => {
      try {
        await updateGenreProfileAssignment(genreId, nextId);
        router.refresh();
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'Failed to update assignment.',
        );
      }
    });
  }

  return (
    <Select
      value={currentProfileId ?? UNASSIGNED_VALUE}
      onValueChange={onChange}
      disabled={pending}
    >
      <SelectTrigger className="h-8 w-[260px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNASSIGNED_VALUE} className="text-xs">
          (unassigned)
        </SelectItem>
        {profiles.map((p) => (
          <SelectItem key={p.id} value={p.id} className="text-xs">
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
