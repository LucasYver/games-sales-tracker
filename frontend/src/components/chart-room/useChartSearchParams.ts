'use client';

import { useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePathname, useRouter } from '@/i18n/navigation';
import {
  CHART_RANGES,
  DEFAULT_CHART_RANGE,
  type ChartRangeKey,
} from '@/components/chart-room/chart-range';

const RANGE_KEYS = new Set<string>(CHART_RANGES.map((r) => r.key));

export function isChartRangeKey(value: string | null): value is ChartRangeKey {
  return value != null && RANGE_KEYS.has(value);
}

/**
 * Read/write `platform` + `range` on the game page query string. `range` is
 * left out of the URL when it equals the game's default period.
 */
export function useChartSearchParams(
  defaultRange: ChartRangeKey = DEFAULT_CHART_RANGE,
) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const platform = searchParams.get('platform');
  const rangeParam = searchParams.get('range');
  const range: ChartRangeKey = isChartRangeKey(rangeParam) ? rangeParam : defaultRange;

  const replaceParams = useCallback(
    (patch: { platform?: string | null; range?: ChartRangeKey | null }) => {
      const params = new URLSearchParams(searchParams.toString());

      if (patch.platform !== undefined) {
        if (patch.platform) params.set('platform', patch.platform);
        else params.delete('platform');
      }
      if (patch.range !== undefined) {
        if (patch.range && patch.range !== defaultRange) params.set('range', patch.range);
        else params.delete('range');
      }

      const qs = params.toString();
      router.replace((qs ? `${pathname}?${qs}` : pathname) as never, {
        scroll: false,
      });
    },
    [defaultRange, pathname, router, searchParams],
  );

  return { platform, range, replaceParams };
}
