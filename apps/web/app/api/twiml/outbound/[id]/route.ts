import { communications, getDb } from '@cema/db';
import { buildOutboundTwiml } from '@cema/integrations-twilio';
import { eq } from 'drizzle-orm';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [comm] = await getDb()
    .select()
    .from(communications)
    .where(eq(communications.id, id))
    .limit(1);

  if (!comm) {
    return new Response('Communication not found', { status: 404 });
  }

  if (!comm.toE164) {
    return new Response('Communication has no destination number', { status: 422 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const statusCallbackUrl = `${appUrl}/api/webhooks/twilio`;

  const xml = buildOutboundTwiml({ toE164: comm.toE164, statusCallbackUrl });

  return new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
