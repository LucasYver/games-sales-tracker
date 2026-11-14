import Link from 'next/link';
import { requireAdminSession, adminFetch } from '@/lib/admin';
import type {
  AdminSocialList,
  BlogPostStatus,
  SocialPostKind,
} from '@/lib/admin';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SocialPostEditor } from '../_components/SocialPostEditor';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<SocialPostKind, string> = {
  BLOG_ARTICLE: 'Blog article',
  WEEKLY_TRENDS: 'Weekly trends',
  GTA6_FIGURE: 'GTA 6 figure',
  MW4_UPDATE: 'MW4 vs Black Ops',
};

const TABS: { id: BlogPostStatus; label: string }[] = [
  { id: 'DRAFT', label: 'Drafts' },
  { id: 'PUBLISHED', label: 'Published' },
  { id: 'REJECTED', label: 'Rejected' },
];

export default async function AdminSocialPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdminSession();
  const { status: raw } = await searchParams;
  const status = TABS.find((t) => t.id === raw)?.id ?? 'DRAFT';
  const { posts, threadsReady, xReady } = await adminFetch<AdminSocialList>(
    `/social?status=${status}`,
  );

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Threads &amp; X</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          The daily <code>social-drafts</code> cron drafts English posts from
          new blog articles and new GTA 6 figures, and on Mondays from the
          week&apos;s trends and the MW4 comparison. Publish posts on Threads
          (with a link preview) and on X (short version with the game&apos;s
          share card; tick &quot;Add link on X&quot; to add the link, about
          $0.20 instead of $0.03). A post already on Threads but not on X can
          still get its X version. Nothing is posted until you click Publish.
        </p>
        {!xReady && (
          <p className="text-muted-foreground mt-2 text-sm">
            X API keys are not set: posts go to Threads only.
          </p>
        )}
        {!threadsReady && (
          <p className="text-destructive mt-2 text-sm">
            THREADS_ACCESS_TOKEN is not set: drafts are written, but nothing
            can be published yet.
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            asChild
            size="sm"
            variant={status === tab.id ? 'default' : 'outline'}
          >
            <Link href={`/admin/social?status=${tab.id}`}>{tab.label}</Link>
          </Button>
        ))}
      </div>
      {posts.length === 0 && (
        <p className="text-muted-foreground text-sm">Nothing in this tab.</p>
      )}
      {posts.map((post) => (
        <Card key={post.id}>
          <CardContent className="flex flex-col gap-3 pt-6">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{KIND_LABEL[post.kind]}</Badge>
              <span className="text-muted-foreground">
                {new Date(post.publishedAt ?? post.createdAt).toLocaleString(
                  'en-GB',
                )}
              </span>
              {post.unverifiedNumbers.length > 0 && (
                <Badge variant="destructive">
                  Unverified: {post.unverifiedNumbers.join(', ')}
                </Badge>
              )}
              {post.externalUrl && (
                <a
                  href={post.externalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  View on Threads
                </a>
              )}
              {post.xExternalUrl && (
                <a
                  href={post.xExternalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  View on X
                </a>
              )}
            </div>
            {post.status === 'DRAFT' || (xReady && !post.xExternalId) ? (
              <SocialPostEditor
                post={post}
                threadsReady={threadsReady}
                xReady={xReady}
              />
            ) : (
              <>
                <p className="whitespace-pre-wrap text-sm">{post.text}</p>
                {post.xText && (
                  <p className="text-muted-foreground whitespace-pre-wrap text-sm">
                    X: {post.xText}
                  </p>
                )}
              </>
            )}
            <p className="text-sm">
              Link preview:{' '}
              <a
                href={post.linkUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {post.linkUrl}
              </a>
            </p>
            {post.lastError && (
              <p className="text-destructive text-sm">
                Last publish error: {post.lastError}
              </p>
            )}
            <details className="text-sm">
              <summary className="text-muted-foreground cursor-pointer">
                Facts given to the writer ({post.facts.length})
              </summary>
              <ul className="mt-2 list-disc pl-5">
                {post.facts.map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
