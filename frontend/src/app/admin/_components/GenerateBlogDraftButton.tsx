'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Newspaper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AdminBlogDetail, GenerateBlogFormatInput } from '@/lib/admin';
import {
  generateBlogDraft,
  generateBlogFormat,
  regenerateBlogPost,
} from '../actions';

export function GenerateBlogDraftButton({
  gameId,
  label = 'Generate blog draft',
}: {
  gameId: string;
  label?: string;
}) {
  return (
    <DraftButton label={label} generate={() => generateBlogDraft(gameId)} />
  );
}

export function GenerateBlogFormatButton({
  input,
  label = 'Generate',
}: {
  input: GenerateBlogFormatInput;
  label?: string;
}) {
  return (
    <DraftButton label={label} generate={() => generateBlogFormat(input)} />
  );
}

export function RegenerateBlogPostButton({
  id,
  label = 'Regenerate',
}: {
  id: string;
  label?: string;
}) {
  return <DraftButton label={label} generate={() => regenerateBlogPost(id)} />;
}

function DraftButton({
  label,
  generate,
}: {
  label: string;
  generate: () => Promise<AdminBlogDetail>;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function onClick() {
    start(async () => {
      try {
        const post = await generate();
        router.push(`/admin/blog/${post.id}`);
      } catch (err) {
        window.alert(
          err instanceof Error ? err.message : 'Draft generation failed',
        );
      }
    });
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={pending}
    >
      <Newspaper aria-hidden="true" className="size-4" />
      {pending ? 'Generating… this can take a minute' : label}
    </Button>
  );
}
