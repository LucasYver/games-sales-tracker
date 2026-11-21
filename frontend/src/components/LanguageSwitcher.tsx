'use client';

import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { useTransition } from 'react';
import { Languages } from 'lucide-react';
import { trackEvent } from '@/lib/analytics';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const LANGUAGE_NAMES: Record<(typeof routing.locales)[number], string> = {
  en: 'English',
  fr: 'Français',
  es: 'Español',
  ru: 'Русский',
  ar: 'العربية',
  'zh-CN': '简体中文',
};

export function LanguageSwitcher({
  localePaths,
}: {
  localePaths?: Partial<Record<string, string>>;
}) {
  const locale = useLocale();
  const t = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const change = (next: string) => {
    trackEvent('language_change', { to: next });
    // Article slugs differ per language: without a path for that locale,
    // land on the blog index rather than a slug that does not exist there.
    const fallback = pathname.startsWith('/blog/') ? '/blog' : pathname;
    startTransition(() => {
      router.replace(localePaths?.[next] ?? fallback, { locale: next });
    });
  };

  return (
    <Select value={locale} onValueChange={change} disabled={isPending}>
      <SelectTrigger
        size="sm"
        aria-label={t('langSwitch')}
        className="border-0 bg-transparent shadow-none dark:bg-transparent"
      >
        <Languages aria-hidden="true" className="hidden size-4 sm:block" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {routing.locales.map((l) => (
          <SelectItem key={l} value={l} lang={l}>
            {LANGUAGE_NAMES[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
