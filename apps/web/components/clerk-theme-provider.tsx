'use client';

import { ClerkProvider } from '@clerk/nextjs';
import { dark } from '@clerk/themes';
import { useTheme } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * Client wrapper that makes the Clerk appearance follow the app's light/dark
 * theme (next-themes). The brand variables stay constant (navy primary, Hanken
 * font); only `baseTheme` flips, so the sign-in/up forms AND the in-app Clerk
 * widgets (OrganizationSwitcher, UserButton, the Settings OrganizationProfile)
 * match dark mode instead of sitting as a light card on a dark canvas.
 *
 * Lives in a client component because `useTheme()` needs the next-themes context;
 * `children` is passed through untouched, so the rest of the tree stays RSC.
 */
export function ClerkThemeProvider({ children }: { children: ReactNode }) {
  const { resolvedTheme } = useTheme();
  return (
    <ClerkProvider
      appearance={{
        baseTheme: resolvedTheme === 'dark' ? dark : undefined,
        variables: {
          colorPrimary: '#10213f', // brand navy — matches the app's primary buttons
          borderRadius: '0.5rem',
          fontFamily: 'var(--font-hanken)',
        },
      }}
    >
      {children}
    </ClerkProvider>
  );
}
