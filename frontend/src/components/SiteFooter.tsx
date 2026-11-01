import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/** Legal links, same on every public page. */
export function SiteFooter() {
  const tNav = useTranslations('nav');

  return (
    <footer className="border-t border-border-soft">
      <div className="mx-auto w-full max-w-6xl px-4 py-3 font-mono text-[0.7rem]">
        <Link
          href="/privacy"
          className="text-muted-foreground hover:text-foreground"
        >
          {tNav('privacy')}
        </Link>
      </div>
    </footer>
  );
}
