'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  CHART_RANGES,
  type ChartRangeKey,
} from '@/components/chart-room/chart-range';

const RANGE_KEYS = new Set<string>(CHART_RANGES.map((r) => r.key));

export function isChartRangeKey(value: string | null): value is ChartRangeKey {
  return value != null && RANGE_KEYS.has(value);
}

/** Read/write `platform` + `range` on the game page query string. */
export function useChartSearchParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const platform = searchParams.get('platform');
  const rangeParam = searchParams.get('range');
  const range: ChartRangeKey = isChartRangeKey(rangeParam) ? rangeParam : '1y';

  const replaceParams = useCallback(
    (patch: { platform?: string | null; range?: ChartRangeKey | null }) => {
      const params = new URLSearchParams(searchParams.toString());

      if (patch.platform !== undefined) {
        if (patch.platform) params.set('platform', patch.platform);
        else params.delete('platform');
      }
      if (patch.range !== undefined) {
        if (patch.range && patch.range !== '1y') params.set('range', patch.range);
        else params.delete('range');
      }

      const qs = params.toString();
      router.replace((qs ? `${pathname}?${qs}` : pathname) as never, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  return { platform, range, replaceParams };
}
