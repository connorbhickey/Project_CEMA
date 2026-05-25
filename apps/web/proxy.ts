import { checkRateLimit, isUpstashConfigured } from '@cema/cache';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';

// Webhooks are authenticated by vendor signature, not Clerk — they must
// remain publicly accessible. Everything else under /api/ is internal
// (queues, crons) or Clerk-protected (server actions).
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/webhooks/(.*)',
  '/api/twiml(.*)',
]);

export default clerkMiddleware(async (auth, req) => {
  // Rate limit inbound webhook endpoints by client IP.
  if (req.nextUrl.pathname.startsWith('/api/webhooks/') && isUpstashConfigured()) {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '127.0.0.1';
    try {
      const { success } = await checkRateLimit(ip);
      if (!success) {
        return new Response('Too Many Requests', { status: 429 });
      }
    } catch {
      // Upstash unavailable — fail open rather than blocking all webhook callbacks
    }
  }

  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
