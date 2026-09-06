import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { SearchBar } from '@/components/SearchBar';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

/** Persistent bar: wordmark, search, language. Same on every public page. */
export function SiteHeader() {
  const t = useTranslations('siteMeta');
  const tNav = useTranslations('nav');

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Link
          href="/"
          className="font-mono text-base font-bold tracking-tight text-foreground"
        >
          {t('siteName')}
        </Link>
        <Link
          href="/ranking"
          className="font-mono text-[0.7rem] tracking-wide text-muted-foreground uppercase hover:text-primary"
        >
          {tNav('ranking')}
        </Link>
        <div className="order-3 w-full sm:order-none sm:ml-auto sm:w-auto sm:max-w-xs sm:flex-1">
          <Suspense fallback={<div className="h-9" />}>
            <SearchBar />
          </Suspense>
        </div>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
