'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { AdminSocialPost } from '@/lib/admin';
import {
  publishSocialPost,
  regenerateSocialPost,
  rejectSocialPost,
  updateSocialPost,
} from '../actions';

/** Each network's limit on a text post. */
const THREADS_MAX = 500;
const X_MAX = 280;

export function SocialPostEditor({
  post,
  threadsReady,
  xReady,
}: {
  post: AdminSocialPost;
  threadsReady: boolean;
  xReady: boolean;
}) {
  const [text, setText] = useState(post.text);
  const [xText, setXText] = useState(post.xText);
  const [pending, start] = useTransition();
  const dirty = text !== post.text || xText !== post.xText;
  const onThreads = !!post.externalId;
  const onX = !!post.xExternalId;
  const threadsTooLong = text.length > THREADS_MAX;
  const xTooLong = xText.length > X_MAX;
  const targets = [
    !onThreads && 'Threads',
    xReady && !onX && 'X',
  ].filter(Boolean) as string[];

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
    const base = `Post this on ${targets.join(' and ')} now? It is public at once.`;
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
    <div className="flex flex-col gap-3">
      <Field
        label={onThreads ? 'Threads (posted)' : 'Threads'}
        value={text}
        max={THREADS_MAX}
        rows={6}
        disabled={pending || onThreads}
        onChange={setText}
      />
      <Field
        label={
          onX
            ? 'X (posted)'
            : xReady
              ? 'X — no link, 280 max'
              : 'X — API keys not set, not posted'
        }
        value={xText}
        max={X_MAX}
        rows={4}
        disabled={pending || onX}
        onChange={setXText}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={
            pending || !dirty || threadsTooLong || xTooLong || !text.trim()
          }
          onClick={() =>
            run(() => updateSocialPost(post.id, { text, xText }), 'Saved.')
          }
        >
          Save
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={
            pending ||
            dirty ||
            threadsTooLong ||
            xTooLong ||
            targets.length === 0 ||
            (!onThreads && !threadsReady)
          }
          title={
            !onThreads && !threadsReady
              ? 'THREADS_ACCESS_TOKEN is not set'
              : dirty
                ? 'Save your edit first'
                : undefined
          }
          onClick={publish}
        >
          {targets.length ? `Publish on ${targets.join(' + ')}` : 'Published'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending || onThreads || onX}
          onClick={() =>
            run(
              async () => {
                const next = await regenerateSocialPost(post.id);
                setText(next.text);
                setXText(next.xText);
              },
              'Rewritten.',
              dirty
                ? 'Rewrite this post? Your unsaved edit will be lost.'
                : undefined,
            )
          }
        >
          Regenerate
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          onClick={() =>
            run(
              () => rejectSocialPost(post.id),
              'Rejected.',
              'Reject this post?',
            )
          }
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  max,
  rows,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  max: number;
  rows: number;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const tooLong = value.length > max;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex justify-between">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={`text-xs ${tooLong ? 'text-destructive' : 'text-muted-foreground'}`}
        >
          {value.length} / {max}
        </span>
      </span>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        disabled={disabled}
      />
    </label>
  );
}
