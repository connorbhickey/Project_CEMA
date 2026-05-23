import { Card, CardContent, CardHeader, CardTitle } from '@cema/ui';
import { notFound } from 'next/navigation';

import { CalendarEventCard } from '@/components/calendar-event-card';
import { CommunicationPlayer } from '@/components/communication-player';
import { EmailThreadViewer } from '@/components/email-thread-viewer';
import { getCalendarEvent } from '@/lib/actions/get-calendar-event';
import { getCommunication } from '@/lib/actions/get-communication';
import { getEmail } from '@/lib/actions/get-email';

function formatE164(e164: string | null | undefined): string {
  if (!e164) return '—';
  if (e164.length === 12 && e164.startsWith('+1')) {
    return `(${e164.slice(2, 5)}) ${e164.slice(5, 8)}-${e164.slice(8)}`;
  }
  return e164;
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

export default async function Page({ params }: { params: Promise<{ id: string; c: string }> }) {
  const { id: dealId, c: communicationId } = await params;
  const data = await getCommunication(dealId, communicationId);

  if (!data) notFound();

  const { communication: comm, recording, signedAudioUrl, transcript } = data;

  if (comm.kind === 'email') {
    const emailData = await getEmail(dealId, communicationId);
    if (!emailData) notFound();
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Email Thread</h1>
          <p className="text-muted-foreground mt-1 text-sm">{formatDate(comm.startedAt)}</p>
        </div>
        <EmailThreadViewer
          communication={emailData.communication}
          emailThread={emailData.emailThread}
        />
      </div>
    );
  }

  if (comm.kind === 'meeting') {
    const eventData = await getCalendarEvent(dealId, communicationId);
    if (!eventData) notFound();
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">
            {eventData.calendarEvent?.title ?? 'Calendar Event'}
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">{formatDate(comm.startedAt)}</p>
        </div>
        <CalendarEventCard
          communication={eventData.communication}
          calendarEvent={eventData.calendarEvent}
          dealId={dealId}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold capitalize">
          {comm.direction} {comm.kind}
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">{formatDate(comm.startedAt)}</p>
      </div>

      {signedAudioUrl ? (
        <CommunicationPlayer
          signedAudioUrl={signedAudioUrl}
          durationSeconds={comm.durationSeconds}
          transcript={transcript}
        />
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm font-medium">No recording available yet</p>
          <p className="text-muted-foreground mt-1 text-xs">
            The recording is ingested automatically after the call ends.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Call details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="divide-y">
              <Row label="Provider" value={comm.provider ?? '—'} />
              <Row label="From" value={formatE164(comm.fromE164)} />
              <Row label="To" value={formatE164(comm.toE164)} />
              <Row label="Duration" value={formatDuration(comm.durationSeconds)} />
              <Row label="Status" value={comm.status} />
              <Row label="Started" value={formatDate(comm.startedAt)} />
              {recording?.consentDisclosureEmittedAt && (
                <Row
                  label="Recording disclosed"
                  value={formatDate(recording.consentDisclosureEmittedAt)}
                />
              )}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>AI summary</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground text-sm italic">Coming in Phase 1.</p>
            <p className="text-muted-foreground mt-1 text-xs">
              AI-generated summaries, action items, and sentiment will appear here after the call is
              transcribed.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
