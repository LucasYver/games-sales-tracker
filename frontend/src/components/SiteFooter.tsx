import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { hubYears } from '@/lib/hub-years';
import { OutboundLink } from '@/components/OutboundLink';

/** The site's own accounts, where the social-drafts cron publishes. */
const SOCIAL_ACCOUNTS = [
  {
    label: 'Threads',
    href: 'https://www.threads.com/@gamesalestracker',
    icon: 'M17.7 11.1c-.1 0-.2-.1-.3-.1-.2-3.2-1.9-5-4.8-5h-.1c-1.7 0-3.2.7-4.1 2.1l1.6 1.1c.7-1 1.7-1.3 2.5-1.3h.1c1 0 1.7.3 2.2.9.4.4.6 1 .7 1.8-.9-.1-1.8-.2-2.8-.1-2.8.2-4.6 1.8-4.5 4.1.1 1.2.7 2.2 1.7 2.8.8.6 1.9.8 3 .8 1.5-.1 2.6-.6 3.4-1.6.6-.7 1-1.7 1.1-2.9.7.4 1.3 1 1.5 1.6.5 1.1.5 2.8-.9 4.2-1.2 1.2-2.7 1.8-4.9 1.8-2.4 0-4.3-.8-5.5-2.3-1.1-1.4-1.7-3.4-1.7-6s.6-4.6 1.7-6c1.2-1.5 3.1-2.3 5.5-2.3 2.5 0 4.4.8 5.6 2.3.6.7 1.1 1.7 1.4 2.8l1.9-.5c-.4-1.4-1-2.6-1.8-3.6C17.5 1.9 15.1.9 12.1.9h-.1C9 .9 6.6 1.9 5.1 3.9 3.7 5.6 3 8 3 11s.7 5.4 2.1 7.1c1.6 2 4 3 7 3h.1c2.7 0 4.6-.7 6.2-2.3 2.1-2.1 2-4.7 1.3-6.3-.5-1.1-1.4-2-2.6-2.6zm-4.6 4.4c-1.2.1-2.4-.5-2.5-1.5 0-.8.6-1.7 2.6-1.8h.7c.7 0 1.4.1 2 .2-.2 2.6-1.5 3-2.8 3.1z',
  },
  {
    label: 'X',
    href: 'https://x.com/gamesalestracke',
    icon: 'M18.2 2.3h3.4l-7.4 8.4 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9L.9 2.3h7l4.8 6.4 5.5-6.4zm-1.2 17.9h1.9L6.8 4.2H4.8L17 20.2z',
  },
];

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
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-text-faint">{tFooter('follow')}</span>
            {SOCIAL_ACCOUNTS.map((account) => (
              <OutboundLink
                key={account.href}
                from="footer"
                href={account.href}
                target="_blank"
                rel="noopener noreferrer me"
                className={`inline-flex items-center gap-1.5 ${linkClass}`}
              >
                <svg
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                  className="size-3.5 fill-current"
                >
                  <path d={account.icon} />
                </svg>
                {account.label}
              </OutboundLink>
            ))}
          </div>
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
