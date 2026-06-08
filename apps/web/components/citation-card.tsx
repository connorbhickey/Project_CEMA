import { FileText, MessageSquare } from 'lucide-react';

import { InboxRow } from '@/components/queue/inbox-row';
import type { SearchHit } from '@/lib/actions/search-similar';

interface CitationCardProps {
  hit: SearchHit;
  href: string;
}

export function CitationCard({ hit, href }: CitationCardProps) {
  const isComm = hit.kind === 'communication';
  return (
    <InboxRow
      href={href}
      icon={isComm ? MessageSquare : FileText}
      iconTint={isComm ? 'text-blue-600 dark:text-blue-400' : 'text-sky-600 dark:text-sky-400'}
      iconBg="bg-blue-500/10"
      title={hit.preview}
      sub={
        <>
          <span className="capitalize">{hit.kind}</span>
          {' · '}similarity {(hit.similarity * 100).toFixed(1)}%
        </>
      }
    />
  );
}
