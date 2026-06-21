'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function SearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const t = useTranslations('searchBar');
  const [value, setValue] = useState(params.get('q') ?? '');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    router.push(trimmed ? `/?q=${encodeURIComponent(trimmed)}` : '/');
  };

  return (
    <form onSubmit={onSubmit} className="flex w-full gap-2" role="search">
      <div className="relative flex-1">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          className="h-11 pl-9"
        />
      </div>
      <Button type="submit" size="lg" className="h-11">
        {t('button')}
      </Button>
    </form>
  );
}
