'use client';

import { useState, useTransition } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  updateTrustedSource,
  type UpdateTrustedSourcePayload,
} from '../actions';

const SOURCE_CATEGORIES = [
  'MEDIA',
  'ANALYST',
  'SOCIAL_X',
  'OFFICIAL_IR',
] as const;

type SourceCategory = (typeof SOURCE_CATEGORIES)[number];

const SALES_TIERS = [
  'OFFICIAL',
  'WIKIPEDIA',
  'ANNOUNCEMENT',
  'MEDIA',
  'STEAM_LEAK',
  'PLAYSTATION_LEAK',
] as const;

type SalesTier = (typeof SALES_TIERS)[number];

function isSourceCategory(value: string): value is SourceCategory {
  return SOURCE_CATEGORIES.includes(value as SourceCategory);
}

function isSalesTier(value: string): value is SalesTier {
  return SALES_TIERS.includes(value as SalesTier);
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

export function EditTrustedSourceForm({
  source,
  onClose,
}: {
  source: {
    id: string;
    slug: string;
    name: string;
    category: string;
    salesSource: string;
    host: string | null;
    handle: string | null;
    url: string | null;
    searchUrlTemplate: string | null;
    feedUrl: string | null;
    language: string;
  };
  onClose: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(source.name);
  const [category, setCategory] = useState<SourceCategory>(
    isSourceCategory(source.category) ? source.category : 'MEDIA',
  );
  const [salesSource, setSalesSource] = useState<SalesTier>(
    isSalesTier(source.salesSource) ? source.salesSource : 'MEDIA',
  );
  const [host, setHost] = useState(source.host ?? '');
  const [handle, setHandle] = useState(source.handle ?? '');
  const [url, setUrl] = useState(source.url ?? '');
  const [searchUrlTemplate, setSearchUrlTemplate] = useState(
    source.searchUrlTemplate ?? '',
  );
  const [feedUrl, setFeedUrl] = useState(source.feedUrl ?? '');
  const [language, setLanguage] = useState(source.language);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Name is required.');
      return;
    }

    const payload: UpdateTrustedSourcePayload = {
      name: trimmedName,
      category,
      salesSource,
      host: emptyToNull(host),
      handle: emptyToNull(handle),
      url: emptyToNull(url),
      searchUrlTemplate: emptyToNull(searchUrlTemplate),
      feedUrl: emptyToNull(feedUrl),
      language: language.trim().toLowerCase(),
    };

    startTransition(async () => {
      try {
        await updateTrustedSource(source.id, payload);
        onClose();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Update failed');
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="border-border bg-muted/40 flex flex-col gap-4 rounded-lg border p-4"
    >
      <p className="text-muted-foreground font-mono text-xs">{source.slug}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`ts-name-${source.id}`}>Name</Label>
          <Input
            id={`ts-name-${source.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={isPending}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ts-category-${source.id}`}>Category</Label>
          <Select
            value={category}
            onValueChange={(value) => {
              if (isSourceCategory(value)) setCategory(value);
            }}
            disabled={isPending}
          >
            <SelectTrigger id={`ts-category-${source.id}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_CATEGORIES.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ts-tier-${source.id}`}>Tier</Label>
          <Select
            value={salesSource}
            onValueChange={(value) => {
              if (isSalesTier(value)) setSalesSource(value);
            }}
            disabled={isPending}
          >
            <SelectTrigger id={`ts-tier-${source.id}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SALES_TIERS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ts-host-${source.id}`}>Host</Label>
          <Input
            id={`ts-host-${source.id}`}
            value={host}
            onChange={(e) => setHost(e.target.value)}
            disabled={isPending}
            placeholder="gamesindustry.biz"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ts-handle-${source.id}`}>Handle</Label>
          <Input
            id={`ts-handle-${source.id}`}
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={isPending}
            placeholder="without @"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`ts-language-${source.id}`}>Language</Label>
          <Input
            id={`ts-language-${source.id}`}
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={isPending}
            required
            minLength={2}
            maxLength={12}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`ts-url-${source.id}`}>Site URL</Label>
          <Input
            id={`ts-url-${source.id}`}
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor={`ts-feed-${source.id}`}>RSS feed URL</Label>
          <Input
            id={`ts-feed-${source.id}`}
            type="url"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            disabled={isPending}
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-4">
          <Label htmlFor={`ts-search-${source.id}`}>Search URL template</Label>
          <Input
            id={`ts-search-${source.id}`}
            value={searchUrlTemplate}
            onChange={(e) => setSearchUrlTemplate(e.target.value)}
            disabled={isPending}
            placeholder="https://example.com/search?q={q}"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
          Save
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClose}
          disabled={isPending}
        >
          <X aria-hidden="true" className="size-4" />
          Cancel
        </Button>
      </div>
    </form>
  );
}
