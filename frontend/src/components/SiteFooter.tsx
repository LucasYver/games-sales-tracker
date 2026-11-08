import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { hubYears } from '@/lib/hub-years';

/** Hub pages and legal links, same on every public page. */
export function SiteFooter() {
  const tNav = useTranslations('nav');

  return (
    <footer className="border-t border-border-soft">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 pt-3 font-mono text-[0.7rem]">
        <Link
          href="/studios"
          className="text-muted-foreground hover:text-foreground"
        >
          {tNav('studios')}
        </Link>
        <Link
          href="/publishers"
          className="text-muted-foreground hover:text-foreground"
        >
          {tNav('publishers')}
        </Link>
        <Link
          href="/franchises"
          className="text-muted-foreground hover:text-foreground"
        >
          {tNav('franchises')}
        </Link>
        <span className="text-muted-foreground">{tNav('years')}</span>
        {hubYears()
          .slice(0, 5)
          .map((year) => (
            <Link
              key={year}
              href={`/year/${year}`}
              className="text-muted-foreground hover:text-foreground"
            >
              {year}
            </Link>
          ))}
      </div>
      <div className="mx-auto flex w-full max-w-6xl gap-4 px-4 pt-1 pb-3 font-mono text-[0.7rem]">
        <Link
          href="/methodology"
          className="text-muted-foreground hover:text-foreground"
        >
          {tNav('methodology')}
        </Link>
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
