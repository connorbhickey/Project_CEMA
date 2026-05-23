'use client';

import { useState, useTransition } from 'react';

import { sendEnvelope } from '@/lib/actions/send-envelope';

interface SendForSignatureButtonProps {
  documentId: string;
  defaultSubject: string;
  recipients: Array<{ email: string; name: string; role: string }>;
  disabled?: boolean;
  disabledReason?: string;
}

export function SendForSignatureButton({
  documentId,
  defaultSubject,
  recipients,
  disabled,
  disabledReason,
}: SendForSignatureButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentEnvelopeId, setSentEnvelopeId] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await sendEnvelope({
          documentId,
          subject: defaultSubject,
          recipients,
        });
        setSentEnvelopeId(res.docusignEnvelopeId);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  if (sentEnvelopeId) {
    return (
      <p className="text-sm text-green-700">
        Sent for signature. DocuSign envelope {sentEnvelopeId}.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || isPending}
        className="inline-flex items-center rounded-md border bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {isPending ? 'Sending…' : 'Send for signature'}
      </button>
      {disabled && disabledReason ? (
        <p className="text-muted-foreground text-xs">{disabledReason}</p>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
