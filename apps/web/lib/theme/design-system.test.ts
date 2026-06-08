import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');
const css = read('../../packages/ui/src/styles/globals.css');
const layout = read('app/layout.tsx');

describe('design tokens — Phase 0 foundation', () => {
  it('wires the Tailwind v4 dark variant and a .dark token block', () => {
    expect(css).toContain('@custom-variant dark');
    expect(css).toMatch(/\.dark\s*\{/);
  });

  it('defines brand, semantic, sidebar and status tokens', () => {
    for (const token of [
      '--primary:',
      '--ring:',
      '--brand-teal:',
      '--savings:',
      '--sidebar:',
      '--status-success:',
      '--sev-critical:',
    ]) {
      expect(css, `missing token ${token}`).toContain(token);
    }
  });

  it('bridges semantic tokens + fonts through @theme inline', () => {
    expect(css).toContain('@theme inline');
    expect(css).toContain('--color-sidebar:');
    expect(css).toContain('--font-sans: var(--font-hanken)');
  });

  it('uses Hanken Grotesk + Geist Mono, never Inter', () => {
    expect(layout).toContain('Hanken_Grotesk');
    expect(layout).toContain('Geist_Mono');
    expect(layout).not.toContain('Inter');
  });

  it('wires FOUC-safe dark mode (ThemeProvider + suppressHydrationWarning)', () => {
    expect(layout).toContain('ThemeProvider');
    expect(layout).toContain('suppressHydrationWarning');
  });
});
