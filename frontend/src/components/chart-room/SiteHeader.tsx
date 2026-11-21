import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SearchBar } from '@/components/SearchBar';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/chart-room/ThemeToggle';
import { SiteNav } from '@/components/chart-room/SiteNav';

/** The site logo (same drawing as `public/logo.svg` and the favicon), inline so it costs no request. */
function SiteLogo() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-6 shrink-0">
      <rect width="48" height="48" rx="11" fill="#4D51DE" />
      <rect x="8" y="30" width="8" height="7" rx="1" fill="#FFFFFF" />
      <rect x="20" y="30" width="8" height="7" rx="1" fill="#FFFFFF" />
      <rect x="20" y="21" width="8" height="7" rx="1" fill="#FFFFFF" />
      <rect x="32" y="30" width="8" height="7" rx="1" fill="#FFFFFF" />
      <rect x="32" y="21" width="8" height="7" rx="1" fill="#FFFFFF" />
      <rect x="32" y="12" width="8" height="7" rx="1" fill="#FBBF24" />
    </svg>
  );
}

/** Persistent bar: logo and wordmark, search, language, then the hub and blog links. Same on every public page. */
export function SiteHeader({
  localePaths,
}: {
  localePaths?: Partial<Record<string, string>>;
}) {
  const t = useTranslations('siteMeta');

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 sm:gap-x-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 font-mono text-base font-bold tracking-tight text-foreground"
        >
          <SiteLogo />
          {t('siteName')}
        </Link>
        <div className="order-3 w-full sm:order-none sm:ms-auto sm:w-auto sm:max-w-xs sm:flex-1">
          <Suspense fallback={<div className="h-9" />}>
            <SearchBar />
          </Suspense>
        </div>
        <div className="ms-auto flex items-center sm:ms-0">
          <LanguageSwitcher localePaths={localePaths} />
          <ThemeToggle />
        </div>
      </div>
      <SiteNav />
    </header>
  );
}
