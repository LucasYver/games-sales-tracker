'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { AdminBlogTranslation } from '@/lib/admin';
import { updateBlogTranslation } from '../actions';

export function BlogTranslationEditor({
  postId,
  translation,
}: {
  postId: string;
  translation: AdminBlogTranslation;
}) {
  const [pending, start] = useTransition();
  const [title, setTitle] = useState(translation.title);
  const [meta, setMeta] = useState(translation.metaDescription);
  const [excerpt, setExcerpt] = useState(translation.excerpt);
  const [tldr, setTldr] = useState(translation.tldr.join('\n'));
  const [body, setBody] = useState(translation.bodyMarkdown);

  function onSave() {
    start(async () => {
      try {
        await updateBlogTranslation(postId, translation.locale, {
          title,
          metaDescription: meta,
          excerpt,
          tldr: tldr
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean),
          bodyMarkdown: body,
        });
        window.alert('Translation saved.');
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Save failed');
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label htmlFor={`${translation.locale}-title`}>Title</Label>
        <Input
          id={`${translation.locale}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor={`${translation.locale}-meta`}>Meta description</Label>
        <Textarea
          id={`${translation.locale}-meta`}
          value={meta}
          onChange={(e) => setMeta(e.target.value)}
          rows={2}
        />
      </div>
      <div>
        <Label htmlFor={`${translation.locale}-excerpt`}>Excerpt</Label>
        <Textarea
          id={`${translation.locale}-excerpt`}
          value={excerpt}
          onChange={(e) => setExcerpt(e.target.value)}
          rows={3}
        />
      </div>
      <div>
        <Label htmlFor={`${translation.locale}-tldr`}>TL;DR (one bullet per line)</Label>
        <Textarea
          id={`${translation.locale}-tldr`}
          value={tldr}
          onChange={(e) => setTldr(e.target.value)}
          rows={3}
        />
      </div>
      <div>
        <Label htmlFor={`${translation.locale}-body`}>Body (markdown)</Label>
        <Textarea
          id={`${translation.locale}-body`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={18}
          className="font-mono text-xs"
        />
        {body.includes('[[sales-table]]') && (
          <p className="text-muted-foreground mt-1 text-xs">
            Keep the <code>[[sales-table]]</code> line: the site renders the
            sales table there, and the popularity cards under the TL;DR, from
            the facts. Do not type those numbers in the text.
          </p>
        )}
      </div>
      <Button type="button" size="sm" onClick={onSave} disabled={pending}>
        {pending ? 'Saving…' : `Save ${translation.locale.toUpperCase()}`}
      </Button>
    </div>
  );
}
