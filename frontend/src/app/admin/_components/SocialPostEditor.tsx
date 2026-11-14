'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { AdminSocialPost } from '@/lib/admin';
import {
  publishSocialPost,
  rejectSocialPost,
  updateSocialPost,
} from '../actions';

/** Threads' limit on a text post. */
const MAX_CHARS = 500;

export function SocialPostEditor({
  post,
  threadsReady,
}: {
  post: AdminSocialPost;
  threadsReady: boolean;
}) {
  const [text, setText] = useState(post.text);
  const [pending, start] = useTransition();
  const dirty = text !== post.text;
  const tooLong = text.length > MAX_CHARS;

  function run(fn: () => Promise<unknown>, done: string, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      try {
        await fn();
        window.alert(done);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Action failed');
      }
    });
  }

  function publish() {
    const base = 'Post this on Threads now? It is public at once.';
    if (post.unverifiedNumbers.length === 0) {
      run(() => publishSocialPost(post.id), 'Posted.', base);
      return;
    }
    run(
      () => publishSocialPost(post.id, true),
      'Posted.',
      `Numbers not found in the facts: ${post.unverifiedNumbers.join(', ')}.\n\n` +
        'Only continue if you checked each one yourself.\n\n' +
        base,
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={6}
        disabled={pending}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`text-xs ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {text.length} / {MAX_CHARS}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || !dirty || tooLong || !text.trim()}
          onClick={() => run(() => updateSocialPost(post.id, text), 'Saved.')}
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={pending || dirty || tooLong || !threadsReady}
          title={
            !threadsReady
              ? 'THREADS_ACCESS_TOKEN is not set'
              : dirty
                ? 'Save your edit first'
                : undefined
          }
          onClick={publish}
        >
          Publish on Threads
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() =>
            run(() => rejectSocialPost(post.id), 'Rejected.', 'Reject this post?')
          }
        >
          Reject
        </Button>
      </div>
    </div>
  );
}
