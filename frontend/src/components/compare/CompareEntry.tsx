'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowLeftRight } from 'lucide-react';
import { compareHref, type PickerGame } from '@/lib/compare';
import { trackEvent } from '@/lib/analytics';
import { Link } from '@/i18n/navigation';
import { GamePicker } from './GamePicker';

/** "Compare" button in the game page header: opens the picker on this game. */
export function CompareButton({
  game,
  suggestions,
}: {
  game: { slug: string; name: string };
  suggestions: PickerGame[];
}) {
  const t = useTranslations('compare');
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[3px] border border-primary/50 px-3 font-mono text-xs font-semibold text-primary hover:bg-accent"
      >
        <ArrowLeftRight aria-hidden className="size-4" />
        {t('compareButton')}
      </button>
      {open && (
        <GamePicker
          base={game}
          suggestions={suggestions}
          from="game_header"
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** "Compare" link on a related-game row of the game page. */
export function CompareLink({
  base,
  other,
}: {
  base: string;
  other: { slug: string; name: string };
}) {
  const t = useTranslations('compare');
  return (
    <Link
      href={compareHref(base, other.slug)}
      prefetch={false}
      onClick={() => trackEvent('compare_pick', { from: 'related_list', game: other.slug })}
      aria-label={t('compareWith', { name: other.name })}
      className="flex size-9 shrink-0 items-center justify-center gap-1.5 rounded-[3px] font-mono text-xs text-primary hover:bg-accent sm:w-auto sm:px-2"
    >
      <ArrowLeftRight aria-hidden className="size-3.5" />
      <span className="hidden sm:inline">{t('compareShort')}</span>
    </Link>
  );
}
