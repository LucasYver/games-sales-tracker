'use client';

import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { useCallback } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  sort: string;
  platform: string;
}

const PLATFORM_ALL = '__all__';

export function GamesFilter({ sort, platform }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('filter');

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}` as never);
    },
    [router, pathname, searchParams],
  );

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sort-select" className="text-muted-foreground text-xs">
          {t('sortLabel')}
        </Label>
        <Select
          value={sort}
          onValueChange={(v) => update('sort', v === 'popular' ? '' : v)}
        >
          <SelectTrigger id="sort-select" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="popular">{t('sortPopular')}</SelectItem>
            <SelectItem value="recent">{t('sortRecent')}</SelectItem>
            <SelectItem value="oldest">{t('sortOldest')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="platform-select"
          className="text-muted-foreground text-xs"
        >
          {t('platformLabel')}
        </Label>
        <Select
          value={platform || PLATFORM_ALL}
          onValueChange={(v) =>
            update('platform', v === PLATFORM_ALL ? '' : v)
          }
        >
          <SelectTrigger id="platform-select" className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={PLATFORM_ALL}>{t('platformAll')}</SelectItem>
            <SelectItem value="PC">PC</SelectItem>
            <SelectItem value="PLAYSTATION">PlayStation</SelectItem>
            <SelectItem value="XBOX">Xbox</SelectItem>
            <SelectItem value="SWITCH">Switch</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
