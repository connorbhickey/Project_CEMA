import { ThemeProvider } from '@cema/ui';
import { ClerkProvider } from '@clerk/nextjs';
import type { Metadata } from 'next';
import { Geist_Mono, Hanken_Grotesk } from 'next/font/google';

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
  title: 'Project_CEMA',
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
          <ClerkProvider
            appearance={{
              variables: {
                colorPrimary: '#10213f', // brand navy — matches the app's primary buttons
                borderRadius: '0.5rem',
                fontFamily: 'var(--font-hanken)',
              },
            }}
          >
            {children}
          </ClerkProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
