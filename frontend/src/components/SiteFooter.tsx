import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { hubYears } from '@/lib/hub-years';

const linkClass =
  'text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

function Column({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <nav aria-label={title}>
      <p className="mb-2 font-mono text-[0.68rem] tracking-wide text-text-faint uppercase">
        {title}
      </p>
      {children}
    </nav>
  );
}

/** Hub pages and legal links, same on every public page. */
export function SiteFooter() {
  const tNav = useTranslations('nav');
  const tFooter = useTranslations('footer');
  const tMeta = useTranslations('siteMeta');

  return (
    <footer className="mt-auto border-t border-border-soft">
      <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-6 text-sm sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="max-w-xs">
          <Link
            href="/"
            className="font-mono font-semibold text-foreground hover:text-primary"
          >
            {tMeta('siteName')}
          </Link>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {tFooter('tagline')}
          </p>
        </div>

        <Column title={tFooter('explore')}>
          <ul className="space-y-1.5">
            <li>
              <Link href="/studios" className={linkClass}>
                {tNav('studios')}
              </Link>
            </li>
            <li>
              <Link href="/publishers" className={linkClass}>
                {tNav('publishers')}
              </Link>
            </li>
            <li>
              <Link href="/franchises" className={linkClass}>
                {tNav('franchises')}
              </Link>
            </li>
            <li>
              <Link href="/blog" className={linkClass}>
                {tNav('blog')}
              </Link>
            </li>
          </ul>
        </Column>

        <Column title={tNav('years')}>
          <ul className="grid grid-cols-3 gap-x-3 gap-y-1.5 font-mono text-xs tabular-nums sm:w-fit">
            {hubYears().map((year) => (
              <li key={year}>
                <Link href={`/year/${year}`} className={linkClass}>
                  {year}
                </Link>
              </li>
            ))}
          </ul>
        </Column>

        <Column title={tFooter('site')}>
          <ul className="space-y-1.5">
            <li>
              <Link href="/methodology" className={linkClass}>
                {tNav('methodology')}
              </Link>
            </li>
            <li>
              <Link href="/about" className={linkClass}>
                {tNav('about')}
              </Link>
            </li>
            <li>
              <Link href="/contact" className={linkClass}>
                {tNav('contact')}
              </Link>
            </li>
            <li>
              <Link href="/privacy" className={linkClass}>
                {tNav('privacy')}
              </Link>
            </li>
          </ul>
        </Column>
      </div>
    </footer>
  );
}
