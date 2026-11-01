import { Suspense } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { hasBlog } from '@/i18n/routing';
import { SearchBar } from '@/components/SearchBar';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeToggle } from '@/components/chart-room/ThemeToggle';

/** Persistent bar: wordmark, search, language. Same on every public page. */
export function SiteHeader({
  localePaths,
}: {
  localePaths?: Partial<Record<string, string>>;
}) {
  const t = useTranslations('siteMeta');
  const tNav = useTranslations('nav');
  const locale = useLocale();

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-2 px-4 py-3 sm:gap-x-4">
        <Link
          href="/"
          className="font-mono text-base font-bold tracking-tight text-foreground"
        >
          {t('siteName')}
        </Link>
        {hasBlog(locale) && (
          <Link
            href="/blog"
            className="font-mono text-sm text-muted-foreground hover:text-foreground"
          >
            {tNav('blog')}
          </Link>
        )}
        <div className="order-3 w-full sm:order-none sm:ml-auto sm:w-auto sm:max-w-xs sm:flex-1">
          <Suspense fallback={<div className="h-9" />}>
            <SearchBar />
          </Suspense>
        </div>
        <div className="ml-auto flex items-center sm:ml-0">
          <LanguageSwitcher localePaths={localePaths} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
