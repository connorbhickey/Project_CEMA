// Tailwind v4 note: @tailwindcss/postcss does not consume this content[] array.
// Content sources are declared via @source in apps/web/app/globals.css. Kept for tooling compatibility.
import type { Config } from 'tailwindcss';

export default {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
} satisfies Config;
