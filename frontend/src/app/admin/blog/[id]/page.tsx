import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireAdminSession, adminFetch } from '@/lib/admin';
import type { AdminBlogDetail } from '@/lib/admin';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { BlogReviewActions } from '../../_components/BlogReviewActions';
import { BlogTranslationEditor } from '../../_components/BlogTranslationEditor';
import { GenerateBlogDraftButton } from '../../_components/GenerateBlogDraftButton';

export const dynamic = 'force-dynamic';

export default async function AdminBlogReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminSession();
  const { id } = await params;
  const post = await adminFetch<AdminBlogDetail>(`/blog/${id}`);
  const facts = post.factPack.facts ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3 self-start">
        <Link href="/admin/blog">
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to blog
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">
              {post.gameName ?? 'Blog draft'}
            </h1>
            <Badge>{post.status}</Badge>
          </div>
          <p className="text-muted-foreground mt-1 font-mono text-xs">
            {post.model ?? 'unknown model'}
            {post.reviewedBy ? ` · reviewed by ${post.reviewedBy}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {post.gameId && (
            <GenerateBlogDraftButton
              gameId={post.gameId}
              label="Regenerate"
            />
          )}
          <BlogReviewActions id={post.id} status={post.status} />
        </div>
      </div>

      {post.rejectReason && (
        <p className="text-destructive text-sm">Rejected: {post.rejectReason}</p>
      )}

      {post.translations.length === 0 && (
        <p className="text-destructive text-sm">
          Generation stopped after saving the fact list — the EN/FR articles
          never reached the database. That list is the source pack, not a
          writing plan. Click Regenerate to write the articles.
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Facts used by the model</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {facts.map((f) => (
            <div key={f.id} className="border-border flex flex-wrap gap-x-3 border-b py-1.5 last:border-0">
              <span className="font-mono text-xs">{f.id}</span>
              <span>
                {f.value.toLocaleString('en-US')} {f.unit}
              </span>
              <span className="text-muted-foreground">
                {f.sourceName}
                {f.date ? ` · ${f.date}` : ''}
                {f.isEngagement ? ' · engagement' : ''}
                {f.isAlinea ? ' · Alinea' : ''}
              </span>
              {f.sourceUrl && (
                <a
                  href={f.sourceUrl}
                  className="text-primary truncate text-xs hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  source
                </a>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {post.translations.map((tr) => (
          <Card key={tr.locale}>
            <CardHeader>
              <CardTitle className="uppercase">{tr.locale}</CardTitle>
              <p className="text-muted-foreground font-mono text-xs">
                /{tr.locale}/blog/{tr.slug}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {tr.unverifiedNumbers.length > 0 && (
                <div className="border-destructive/40 bg-destructive/5 rounded border px-3 py-2 text-sm">
                  <p className="font-semibold">Unverified numbers</p>
                  <p className="mt-1">{tr.unverifiedNumbers.join(' · ')}</p>
                </div>
              )}
              {tr.reviewIssues.length > 0 && (
                <div className="space-y-2 text-sm">
                  <p className="font-semibold">Editor issues</p>
                  {tr.reviewIssues.map((issue, i) => (
                    <div key={`${issue.excerpt}-${i}`}>
                      <Badge variant="outline">{issue.severity}</Badge>{' '}
                      <span className="font-medium">{issue.problem}</span>
                      <p className="text-muted-foreground mt-0.5">
                        “{issue.excerpt}” — {issue.suggestion}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <BlogTranslationEditor postId={post.id} translation={tr} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
