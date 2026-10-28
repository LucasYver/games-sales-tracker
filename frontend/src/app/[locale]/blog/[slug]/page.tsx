import { getTranslations, getFormatter } from 'next-intl/server';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Image from 'next/image';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from '@/i18n/navigation';
import { SALES_TABLE_MARKER, getBlogPost } from '@/lib/api';
import { displayCover } from '@/lib/cover';
import { SITE_URL } from '@/lib/site-url';
import { SiteHeader } from '@/components/chart-room/SiteHeader';
import { PopularityCards, SalesTable } from '@/components/blog/BlogFigures';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await getBlogPost(locale, slug);
  if (!post) return { title: 'Not found' };

  const path = `/${locale}/blog/${post.slug}`;
  const alt = post.alternate;
  return {
    title: post.title,
    description: post.metaDescription,
    alternates: {
      canonical: path,
      languages: {
        [post.locale]: path,
        ...(alt ? { [alt.locale]: `/${alt.locale}/blog/${alt.slug}` } : {}),
        'x-default':
          post.locale === 'en'
            ? path
            : alt
              ? `/${alt.locale}/blog/${alt.slug}`
              : path,
      },
    },
    openGraph: {
      title: post.title,
      description: post.metaDescription,
      type: 'article',
      locale,
      url: `${SITE_URL}${path}`,
      publishedTime: post.publishedAt ?? undefined,
      modifiedTime: post.updatedAt ?? post.publishedAt ?? undefined,
      images: post.game?.coverUrl
        ? [{ url: post.game.coverUrl, alt: post.game.name }]
        : [],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.metaDescription,
      images: post.game?.coverUrl ? [post.game.coverUrl] : [],
    },
  };
}

export default async function BlogArticlePage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const [post, t, format] = await Promise.all([
    getBlogPost(locale, slug),
    getTranslations({ locale, namespace: 'blog' }),
    getFormatter({ locale }),
  ]);
  if (!post) notFound();

  const longDate = (iso: string) =>
    format.dateTime(new Date(iso), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  const published = post.publishedAt ? longDate(post.publishedAt) : null;
  // Only worth a line when the text changed after it went live.
  const updated =
    post.updatedAt &&
    post.publishedAt &&
    longDate(post.updatedAt) !== longDate(post.publishedAt)
      ? longDate(post.updatedAt)
      : null;
  const asOf = post.figuresAsOf
    ? format.dateTime(new Date(post.figuresAsOf), {
        year: 'numeric',
        month: 'long',
        timeZone: 'UTC',
      })
    : null;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: post.title,
        description: post.metaDescription,
        datePublished: post.publishedAt,
        dateModified: post.updatedAt ?? post.publishedAt,
        inLanguage: locale,
        image: post.game?.coverUrl ?? undefined,
        about: post.game
          ? {
              '@type': 'VideoGame',
              name: post.game.name,
              url: `${SITE_URL}/${locale}/game/${post.game.slug}`,
            }
          : undefined,
        author: {
          '@type': 'Organization',
          name: 'Game Sales Tracker',
          url: SITE_URL,
        },
        publisher: {
          '@type': 'Organization',
          name: 'Game Sales Tracker',
          url: SITE_URL,
        },
        mainEntityOfPage: `${SITE_URL}/${locale}/blog/${post.slug}`,
      },
      // Older articles only: new ones have no FAQ.
      ...(post.faq.length > 0
        ? [
            {
              '@type': 'FAQPage',
              mainEntity: post.faq.map((item) => ({
                '@type': 'Question',
                name: item.question,
                acceptedAnswer: { '@type': 'Answer', text: item.answer },
              })),
            },
          ]
        : []),
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: t('breadcrumbHome'),
            item: `${SITE_URL}/${locale}`,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: t('breadcrumbBlog'),
            item: `${SITE_URL}/${locale}/blog`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: post.title,
            item: `${SITE_URL}/${locale}/blog/${post.slug}`,
          },
        ],
      },
    ],
  };

  return (
    <main className="flex min-h-screen flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          // `<` escaped so article text can never close the script tag.
          __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <SiteHeader
        localePaths={{
          [post.locale]: `/blog/${post.slug}`,
          ...(post.alternate
            ? { [post.alternate.locale]: `/blog/${post.alternate.slug}` }
            : {}),
        }}
      />
      <article className="mx-auto w-full max-w-3xl px-4 py-8">
        <nav className="mb-6 font-mono text-[0.72rem] text-text-faint">
          <Link href="/" className="text-muted-foreground hover:text-primary">
            {t('breadcrumbHome')}
          </Link>
          <span className="mx-2">/</span>
          <Link
            href="/blog"
            className="text-muted-foreground hover:text-primary"
          >
            {t('breadcrumbBlog')}
          </Link>
          <span className="mx-2">/</span>
          <span className="text-muted-foreground">{post.title}</span>
        </nav>

        <ArticleHeader
          title={post.title}
          coverUrl={post.game?.coverUrl ?? null}
          coverAlt={post.game?.name ?? post.title}
          publishedLabel={
            published ? t('publishedOn', { date: published }) : null
          }
          updatedLabel={updated ? t('updatedOn', { date: updated }) : null}
          asOfLabel={asOf ? t('figuresAsOf', { date: asOf }) : null}
        />

        <aside className="my-6 border border-border bg-card px-4 py-3">
          <p className="font-mono text-[0.68rem] tracking-wide text-text-faint uppercase">
            {t('tldrTitle')}
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {post.tldr.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </aside>

        {post.figures && <PopularityCards signals={post.figures.signals} />}

        <div className="blog-prose text-sm leading-relaxed">
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ href, children }) =>
                href?.startsWith('/') ? (
                  <Link href={href} className="text-primary hover:underline">
                    {children}
                  </Link>
                ) : (
                  <a
                    href={href}
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {children}
                  </a>
                ),
              h1: ({ children }) => (
                <h2 className="mt-8 mb-3 text-xl font-semibold">{children}</h2>
              ),
              h2: ({ children }) => (
                <h2 className="mt-8 mb-3 text-xl font-semibold">{children}</h2>
              ),
              h3: ({ children }) => (
                <h3 className="mt-6 mb-2 text-lg font-semibold">{children}</h3>
              ),
              // The marker line becomes the sales table built from the facts.
              p: ({ children }) =>
                children === SALES_TABLE_MARKER ? (
                  post.figures ? (
                    <SalesTable sales={post.figures.sales} />
                  ) : null
                ) : (
                  <p className="mb-4">{children}</p>
                ),
              ul: ({ children }) => (
                <ul className="mb-4 list-disc space-y-1 pl-5">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="mb-4 list-decimal space-y-1 pl-5">{children}</ol>
              ),
              table: ({ children }) => (
                <div className="mb-6 overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border-b border-border px-2 py-1.5 font-mono text-[0.68rem] tracking-wide text-text-faint uppercase">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border-b border-border px-2 py-1.5 align-top">
                  {children}
                </td>
              ),
            }}
          >
            {post.bodyMarkdown}
          </Markdown>
        </div>

        {post.faq.length > 0 && (
          <section className="mt-10 border-t border-border pt-6">
            <h2 className="text-xl font-semibold">{t('faqTitle')}</h2>
            <dl className="mt-4 space-y-4">
              {post.faq.map((item) => (
                <div key={item.question}>
                  <dt className="font-semibold">{item.question}</dt>
                  <dd className="mt-1 text-sm text-muted-foreground">
                    {item.answer}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {post.game && (
          <p className="mt-10">
            <Link
              href={`/game/${post.game.slug}`}
              className="text-primary hover:underline"
            >
              {t('ctaGame', { name: post.game.name })}
            </Link>
          </p>
        )}
      </article>
    </main>
  );
}

function ArticleHeader({
  title,
  coverUrl,
  coverAlt,
  publishedLabel,
  updatedLabel,
  asOfLabel,
}: {
  title: string;
  coverUrl: string | null;
  coverAlt: string;
  publishedLabel: string | null;
  updatedLabel: string | null;
  asOfLabel: string | null;
}) {
  const cover = coverUrl ? displayCover(coverUrl) : null;
  const titleBlock = (
    <div className="min-w-0 flex-1">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        {[publishedLabel, updatedLabel].filter(Boolean).join(' · ')}
      </p>
      {asOfLabel && (
        <p className="mt-1 font-mono text-[0.72rem] text-text-faint">
          {asOfLabel}
        </p>
      )}
    </div>
  );

  if (!cover) {
    return <header className="border-b border-border pb-6">{titleBlock}</header>;
  }

  if (cover.kind === 'landscape') {
    return (
      <header className="border-b border-border pb-6">
        <div className="relative mb-5 aspect-[616/353] overflow-hidden rounded-[3px] bg-muted">
          <Image
            src={cover.src}
            alt={coverAlt}
            fill
            priority
            sizes="768px"
            className="object-cover"
          />
        </div>
        {titleBlock}
      </header>
    );
  }

  return (
    <header className="border-b border-border pb-6">
      <div className="flex items-start gap-4 sm:gap-5">
        <div className="relative aspect-[3/4] w-28 shrink-0 overflow-hidden rounded-[3px] bg-muted sm:w-36">
          <Image
            src={cover.src}
            alt={coverAlt}
            fill
            priority
            sizes="144px"
            className="object-cover"
          />
        </div>
        {titleBlock}
      </div>
    </header>
  );
}
