'use client';

import { useTransition } from 'react';
import { Button } from '@/components/ui/button';
import {
  publishBlogPost,
  rejectBlogPost,
  unpublishBlogPost,
} from '../actions';

export function BlogReviewActions({
  id,
  status,
  isLive,
  isRefresh,
  unverifiedCount,
  errorCount,
}: {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'REJECTED';
  isLive: boolean;
  isRefresh: boolean;
  unverifiedCount: number;
  errorCount: number;
}) {
  const [pending, start] = useTransition();

  function run(fn: () => Promise<unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      try {
        await fn();
        window.alert('Saved.');
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Action failed');
      }
    });
  }

  function publish() {
    const blockers = unverifiedCount + errorCount;
    const base = isRefresh
      ? 'Replace the live article with this new version (both languages)?'
      : 'Publish both languages? This will appear on the public blog.';
    if (blockers === 0) {
      run(() => publishBlogPost(id), base);
      return;
    }
    // The API refuses unless forced: make the reviewer read what is left.
    run(
      () => publishBlogPost(id, true),
      `${unverifiedCount} unverified number(s) and ${errorCount} fact-check error(s) are still open.\n\n` +
        'Publishing a wrong figure hurts the site. Only continue if you checked each one yourself.\n\n' +
        `${base}`,
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === 'DRAFT' && (
        <Button type="button" size="sm" disabled={pending} onClick={publish}>
          {isRefresh ? 'Publish update' : 'Publish'}
        </Button>
      )}
      {isLive && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              () => unpublishBlogPost(id),
              'Take this article off the public blog?',
            )
          }
        >
          Unpublish
        </Button>
      )}
      {status === 'DRAFT' && (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            if (isRefresh) {
              run(
                () => rejectBlogPost(id),
                'Discard this update? The live article stays as it is, and this change in figures will not be proposed again.',
              );
              return;
            }
            const reason =
              window.prompt('Reject reason (optional)') ?? undefined;
            run(() => rejectBlogPost(id, reason || undefined));
          }}
        >
          {isRefresh ? 'Discard update' : 'Reject'}
        </Button>
      )}
    </div>
  );
}
