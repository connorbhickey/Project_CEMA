'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import * as React from 'react';

import { Button } from './button';

const ORDER = ['light', 'dark', 'system'] as const;
type ThemeChoice = (typeof ORDER)[number];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Render a stable placeholder on the server / first paint.
  if (!mounted) {
    return (
      <Button variant="ghost" size="sm" aria-label="Toggle theme" disabled>
        <Monitor className="h-4 w-4" />
      </Button>
    );
  }

  const current = (ORDER as readonly string[]).includes(theme ?? '')
    ? (theme as ThemeChoice)
    : 'system';
  // noUncheckedIndexedAccess: the modulo guarantees an in-bounds index; the ?? is unreachable but required by tsc
  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'system';
  const Icon = current === 'dark' ? Moon : current === 'light' ? Sun : Monitor;

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Theme: ${current}. Switch to ${next}.`}
      onClick={() => setTheme(next)}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
