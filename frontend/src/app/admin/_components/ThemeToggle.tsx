'use client';

import { useSyncExternalStore } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Class-based dark-mode toggle (Tailwind `.dark` on <html>). The initial class
 * is set by the inline script in the admin layout to avoid a flash; this button
 * reflects and flips it, persisting the choice.
 *
 * Reads the current theme via `useSyncExternalStore` (a MutationObserver on the
 * root class) rather than effect-driven state, so it stays in sync with the DOM
 * without cascading renders.
 */
function subscribe(callback: () => void): () => void {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
  return () => observer.disconnect();
}

function isDark(): boolean {
  return document.documentElement.classList.contains('dark');
}

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, isDark, () => false);

  const toggle = () => {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // ignore storage failures (private mode etc.)
    }
  };

  return (
    <Button
      variant="ghost"
      type="button"
      onClick={toggle}
      className="text-muted-foreground w-full justify-start"
      aria-label="Toggle dark mode"
    >
      {dark ? (
        <Sun aria-hidden="true" className="size-4" />
      ) : (
        <Moon aria-hidden="true" className="size-4" />
      )}
      {dark ? 'Light mode' : 'Dark mode'}
    </Button>
  );
}
