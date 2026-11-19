import { ChartLine } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { getSalesTimeline } from '@/lib/api';
import {
  GTA6_BANNER_UNTIL,
  GTA6_PATH,
  GTA6_SLUG,
  latestGta6Figure,
} from '@/lib/gta6';
import { PromoLink } from '@/components/PromoLink';

/**
 * Home banner pointing to the GTA 6 sales page during the launch buzz. It
 * hides itself after GTA6_BANNER_UNTIL, no deploy needed. The timeline fetch
 * is the one the GTA 6 page already caches (5 minutes), so it adds no query.
 */
export async function Gta6HomeBanner({ locale }: { locale: string }) {
  if (new Date().toISOString().slice(0, 10) > GTA6_BANNER_UNTIL) return null;
  const [t, timeline] = await Promise.all([
    getTranslations({ locale, namespace: 'gta6Sales' }),
    getSalesTimeline(GTA6_SLUG),
  ]);
  const latest = latestGta6Figure(timeline?.figures ?? []);
  const units = latest
    ? new Intl.NumberFormat(locale, {
        notation: 'compact',
        maximumFractionDigits: 1,
      }).format(latest.units)
    : null;

  return (
    <PromoLink
      href={GTA6_PATH}
      from="home"
      target="gta-6-sales"
      className="mb-5 flex items-center gap-3 rounded-[3px] border border-primary/40 bg-accent px-4 py-3 text-accent-foreground hover:underline"
    >
      <ChartLine className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 text-sm">
        <span className="font-semibold">
          {units ? t('homeBannerUnits', { units }) : t('homeBannerTitle')}
        </span>{' '}
        <span className="text-muted-foreground">{t('homeBannerCta')}</span>
      </span>
    </PromoLink>
  );
}
