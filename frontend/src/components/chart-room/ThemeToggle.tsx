'use client';

import { useLayoutEffect, useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Public light/dark theme: the visitor's stored choice, otherwise the system
 * setting. Uses its own storage key because admin, on the same origin, uses
 * `theme`. A cookie would make every page dynamic, so the choice stays in the
 * browser.
 */
const STORAGE_KEY = 'chart-theme';
const LIGHT_QUERY = '(prefers-color-scheme: light)';

const THEME_SCRIPT = `try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='light'||(t!=='dark'&&window.matchMedia('${LIGHT_QUERY}').matches)){document.documentElement.classList.remove('dark')}}catch(e){}`;

function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The server HTML is dark, so a visitor without JS keeps the original look. The
 * inline script switches to light before paint to avoid a flash of the wrong
 * theme. Changing language re-renders <html> on the client and restores the
 * `dark` class from the layout, without running the script, so the layout
 * effect applies the theme again. The script is inert on the client, which is
 * also what keeps React from warning about it.
 */
export function ThemeScript() {
  useLayoutEffect(() => {
    const stored = readStoredTheme();
    const light =
      stored === 'light' ||
      (stored !== 'dark' && window.matchMedia(LIGHT_QUERY).matches);
    document.documentElement.classList.toggle('dark', !light);
  }, []);

  return (
    <script
      type={typeof window === 'undefined' ? undefined : 'text/plain'}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }}
    />
  );
}

function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });

  // Follow a system change until the visitor has made their own choice.
  const media = window.matchMedia(LIGHT_QUERY);
  const onSystemChange = () => {
    if (readStoredTheme()) return;
    document.documentElement.classList.toggle('dark', !media.matches);
  };
  media.addEventListener('change', onSystemChange);

  return () => {
    observer.disconnect();
    media.removeEventListener('change', onSystemChange);
  };
}

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function ThemeToggle() {
  const t = useTranslations('nav');
  // The server HTML is dark, whatever the visitor ends up seeing.
  const dark = useSyncExternalStore(subscribe, isDark, () => true);

  const toggle = () => {
    const next = !isDark();
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'dark' : 'light');
    } catch {
      // ignore storage failures (private mode etc.)
    }
  };

  const label = dark ? t('themeLight') : t('themeDark');

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={toggle}
      aria-label={label}
      title={label}
    >
      {dark ? (
        <Sun aria-hidden="true" className="size-4" />
      ) : (
        <Moon aria-hidden="true" className="size-4" />
      )}
    </Button>
  );
}
