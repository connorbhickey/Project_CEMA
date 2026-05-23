import type { communications, emailThreads } from '@cema/db';

type Communication = typeof communications.$inferSelect;
type EmailThread = typeof emailThreads.$inferSelect;

interface EmailThreadViewerProps {
  communication: Communication;
  emailThread: EmailThread | null;
}

function formatDate(date: Date | null | undefined): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(date);
}

export function EmailThreadViewer({ communication, emailThread }: EmailThreadViewerProps) {
  if (!emailThread) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">Email content not yet available.</p>
      </div>
    );
  }

  const attachmentIds = emailThread.nylasAttachmentIds ?? [];
  const hasAttachments = emailThread.hasAttachments && attachmentIds.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">{emailThread.subject ?? '(no subject)'}</h2>
        <div className="text-muted-foreground mt-1 space-y-0.5 text-sm">
          <p>
            <span className="font-medium">From:</span>{' '}
            {emailThread.fromName
              ? `${emailThread.fromName} <${emailThread.fromEmail ?? ''}>`
              : (emailThread.fromEmail ?? '—')}
          </p>
          <p>
            <span className="font-medium">Date:</span> {formatDate(communication.startedAt)}
          </p>
          {emailThread.messageCount > 1 ? (
            <p>
              <span className="font-medium">Thread length:</span> {emailThread.messageCount}{' '}
              messages
            </p>
          ) : null}
        </div>
      </div>

      {emailThread.bodyHtml ? (
        <div className="rounded-lg border">
          {/* iframe srcDoc sandboxes external HTML — prevents CSS bleed and
              limits the surface for XSS from untrusted email bodies. */}
          <iframe
            srcDoc={emailThread.bodyHtml}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="h-96 w-full rounded-lg"
            title="Email body"
          />
        </div>
      ) : emailThread.bodyPlain ? (
        <div className="rounded-lg border p-4">
          <pre className="text-muted-foreground whitespace-pre-wrap text-sm">
            {emailThread.bodyPlain}
          </pre>
        </div>
      ) : null}

      {hasAttachments ? (
        <div className="rounded-lg border p-4">
          <p className="text-sm font-medium">Attachments ({attachmentIds.length})</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Attachment download links available in Phase 1 (IDP integration).
          </p>
        </div>
      ) : null}
    </div>
  );
}
