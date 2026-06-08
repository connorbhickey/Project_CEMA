import { ThemeProvider } from '@cema/ui';
import type { Metadata } from 'next';
import { Geist_Mono, Hanken_Grotesk } from 'next/font/google';

import { ClerkThemeProvider } from '@/components/clerk-theme-provider';

import './globals.css';

const fontSans = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
});
const fontMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Empyre',
  description: 'AI-powered CEMA mortgage processing for NY-state lenders',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${fontSans.variable} ${fontMono.variable}`}
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <ClerkThemeProvider>{children}</ClerkThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
