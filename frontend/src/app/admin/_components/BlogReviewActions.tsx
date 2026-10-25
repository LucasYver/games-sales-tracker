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
}: {
  id: string;
  status: 'DRAFT' | 'PUBLISHED' | 'REJECTED';
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

  return (
    <div className="flex flex-wrap gap-2">
      {status !== 'PUBLISHED' && (
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              () => publishBlogPost(id),
              'Publish both languages? This will appear on the public blog.',
            )
          }
        >
          Publish
        </Button>
      )}
      {status === 'PUBLISHED' && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => unpublishBlogPost(id), 'Take this article off the public blog?')
          }
        >
          Unpublish
        </Button>
      )}
      {status !== 'REJECTED' && (
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() => {
            const reason = window.prompt('Reject reason (optional)') ?? undefined;
            run(() => rejectBlogPost(id, reason || undefined));
          }}
        >
          Reject
        </Button>
      )}
    </div>
  );
}
