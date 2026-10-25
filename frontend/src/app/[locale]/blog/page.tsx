import { getTranslations } from 'next-intl/server';
import type { Metadata } from 'next';
import Image from 'next/image';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { getBlogIndex } from '@/lib/api';
import { SITE_URL } from '@/lib/site-url';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { Pagination } from '@/components/Pagination';

const PAGE_SIZE = 20;

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const { page: pageRaw } = await searchParams;
  const t = await getTranslations({ locale, namespace: 'blog' });
  const page = Math.max(1, Number(pageRaw) || 1);
  const path = page > 1 ? `/${locale}/blog?page=${page}` : `/${locale}/blog`;
  return {
    title: t('metaIndexTitle'),
    description: t('indexDescription'),
    alternates: {
      canonical: path,
      languages: {
        en: page > 1 ? `/en/blog?page=${page}` : '/en/blog',
        fr: page > 1 ? `/fr/blog?page=${page}` : '/fr/blog',
        'x-default': page > 1 ? `/en/blog?page=${page}` : '/en/blog',
      },
    },
    openGraph: {
      title: t('metaIndexTitle'),
      description: t('indexDescription'),
      type: 'website',
      locale,
      url: `${SITE_URL}${path}`,
    },
  };
}

export default async function BlogIndexPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  const { page: pageRaw } = await searchParams;
  const page = Math.max(1, Number(pageRaw) || 1);
  const t = await getTranslations({ locale, namespace: 'blog' });
  const { items, total } = await getBlogIndex(
    locale,
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE,
  );
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Blog',
        name: t('indexTitle'),
        description: t('indexDescription'),
        inLanguage: locale,
        url: `${SITE_URL}/${locale}/blog`,
      },
      {
        '@type': 'ItemList',
        itemListElement: items.map((item, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          url: `${SITE_URL}/${locale}/blog/${item.slug}`,
          name: item.title,
        })),
      },
    ],
  };

  return (
    <main className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <SiteHeader />
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <nav className="mb-6 font-mono text-[0.72rem] text-text-faint">
          <Link href="/" className="text-muted-foreground hover:text-primary">
            {t('breadcrumbHome')}
          </Link>
          <span className="mx-2">/</span>
          {t('breadcrumbBlog')}
        </nav>
        <h1 className="text-3xl font-bold tracking-tight">{t('indexTitle')}</h1>
        <p className="mt-3 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          {t('indexIntro')}
        </p>

        {items.length === 0 ? (
          <p className="mt-10 text-sm text-muted-foreground">{t('empty')}</p>
        ) : (
          <ul className="mt-8 divide-y divide-border">
            {items.map((item) => (
              <li key={item.slug} className="py-5">
                <Link
                  href={`/blog/${item.slug}`}
                  className="group flex gap-4 hover:no-underline"
                >
                  {item.game?.coverUrl && (
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-[3px] bg-muted">
                      <Image
                        src={item.game.coverUrl}
                        alt={item.game.name}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    </div>
                  )}
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold tracking-tight group-hover:text-primary">
                      {item.title}
                    </h2>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {item.excerpt}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <Pagination page={page} pageCount={pageCount} />
      </div>
    </main>
  );
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}
