'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Newspaper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { generateBlogDraft } from '../actions';

export function GenerateBlogDraftButton({
  gameId,
  label = 'Generate blog draft',
}: {
  gameId: string;
  label?: string;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function onClick() {
    start(async () => {
      try {
        const post = await generateBlogDraft(gameId);
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
