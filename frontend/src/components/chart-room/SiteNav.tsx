'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';

/**
 * Second row of the header: the studio, publisher and franchise hubs and the
 * blog, one tap away on every public page. The current section is marked;
 * on a phone the row scrolls sideways instead of wrapping.
 */
export function SiteNav() {
  const tNav = useTranslations('nav');
  const pathname = usePathname();
  const items = [
    { href: '/studios', section: '/studio', label: tNav('studios') },
    { href: '/publishers', section: '/publisher', label: tNav('publishers') },
    { href: '/franchises', section: '/franchise', label: tNav('franchises') },
    { href: '/blog', section: '/blog', label: tNav('blog') },
  ];

  return (
    <nav aria-label={tNav('main')} className="border-t border-border-soft">
      <ul className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-2 sm:px-3">
        {items.map((item) => {
          const current = pathname.startsWith(item.section);
          return (
            <li key={item.href} className="shrink-0">
              <Link
                href={item.href}
                aria-current={current ? 'page' : undefined}
                className={`inline-flex h-10 items-center border-b-2 px-2 font-mono text-[0.8rem] transition-colors ${
                  current
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
