import { Card, CardContent, CardHeader, CardTitle } from '@cema/ui';
import { notFound } from 'next/navigation';

import { getDeal } from '@/lib/actions/get-deal';

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getDeal(id);
  if (!data) notFound();
  const { deal, property, newLoan, existingLoans } = data;
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">
        {deal.cemaType === 'refi_cema' ? 'Refi CEMA' : 'Purchase CEMA'} · {deal.status}
      </h1>
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
                <Row k="Type" v={property.propertyType} />
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
                <Row k="Program" v={newLoan.program} />
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
