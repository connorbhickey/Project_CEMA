import { Card, CardContent, CardHeader, CardTitle } from '@cema/ui';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getDeal } from '@/lib/actions/get-deal';
import { parseDealRecording } from '@/lib/deals/deal-recording';
import { dealStatusLabel } from '@/lib/deals/deal-status';
import { cemaTypeLabel, loanProgramLabel, propertyTypeLabel } from '@/lib/deals/enum-labels';
import { partyRoleLabel } from '@/lib/deals/party-role';
import { getDealParties } from '@/lib/queries/deal-parties';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDeal(id);
  if (!data) notFound();
  const { deal, property, newLoan, existingLoans } = data;
  const recording = parseDealRecording(deal.metadata);
  const parties = await getDealParties(id);
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">
        {cemaTypeLabel(deal.cemaType)} · {dealStatusLabel(deal.status)}
      </h1>

      {recording ? (
        <div className="mb-6 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
          <span className="font-medium">Recorded</span>
          {recording.venue ? <> · {recording.venue}</> : null} ·{' '}
          {recording.crfn ? `CRFN ${recording.crfn}` : `Reel/Page ${recording.reelPage}`}
          {recording.recordedAt ? ` · ${recording.recordedAt}` : null}
        </div>
      ) : null}
      <nav className="mb-6 flex gap-4 text-sm">
        <Link href={`/deals/${id}/parties`} className="text-blue-600 hover:underline">
          Parties
        </Link>
        <Link href={`/deals/${id}/documents`} className="text-blue-600 hover:underline">
          Documents &amp; chain of title
        </Link>
        <Link href={`/deals/${id}/loans`} className="text-blue-600 hover:underline">
          Existing loans
        </Link>
        <Link href={`/deals/${id}/exceptions`} className="text-blue-600 hover:underline">
          Exceptions
        </Link>
        <Link href={`/deals/${id}/agent-activity`} className="text-blue-600 hover:underline">
          Agent activity
        </Link>
      </nav>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Property</CardTitle>
          </CardHeader>
          <CardContent>
            {property ? (
              <dl className="space-y-1 text-sm">
                <Row
                  k="Address"
                  v={`${property.streetAddress}${property.unit ? ` ${property.unit}` : ''}`}
                />
                <Row k="City / County" v={`${property.city}, ${property.county}`} />
                <Row k="ZIP" v={property.zipCode} />
                <Row k="Type" v={propertyTypeLabel(property.propertyType)} />
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">No property yet.</p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>New loan</CardTitle>
          </CardHeader>
          <CardContent>
            {newLoan ? (
              <dl className="space-y-1 text-sm">
                <Row k="Principal" v={`$${newLoan.principal}`} />
                <Row k="Program" v={loanProgramLabel(newLoan.program)} />
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">No new loan yet.</p>
            )}
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Existing loans ({existingLoans.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {existingLoans.length === 0 ? (
              <p className="text-muted-foreground text-sm">No existing loans yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {existingLoans.map((loan) => (
                  <li key={loan.id} className="flex justify-between border-b pb-2 last:border-0">
                    <span>UPB: ${loan.upb}</span>
                    <span>Chain position: {loan.chainPosition}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Parties ({parties.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {parties.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No parties yet.{' '}
                <Link href={`/deals/${id}/parties`} className="text-blue-600 hover:underline">
                  Add them →
                </Link>
              </p>
            ) : (
              <ul className="space-y-2 text-sm">
                {parties.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b pb-2 last:border-0"
                  >
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium">
                      {partyRoleLabel(p.role)}
                    </span>
                    <span>{p.fullName ?? '—'}</span>
                    {p.email ? (
                      <span className="text-muted-foreground text-xs">{p.email}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
