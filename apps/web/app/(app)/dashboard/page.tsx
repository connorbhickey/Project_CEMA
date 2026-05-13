import { Card, CardContent, CardHeader, CardTitle } from '@cema/ui';

export default function Page() {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold">Dashboard</h1>
      <Card>
        <CardHeader>
          <CardTitle>Welcome</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Your CEMA pipeline will appear here once you create your first Deal.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
