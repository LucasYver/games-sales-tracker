import { adminFetch, type AdminTrustedSource } from '@/lib/admin';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SourcesTable } from './SourcesTable';

export const dynamic = 'force-dynamic';

export default async function AdminTrustedSourcesPage() {
  const sources = await adminFetch<AdminTrustedSource[]>('/trusted-sources');

  const active = sources.filter((s) => s.active);
  const inactive = sources.filter((s) => !s.active);
  const autoCreated = sources.filter((s) => s.autoCreated).length;
  const totalRecords = sources.reduce(
    (sum, s) => sum + (s.recordCount ?? 0),
    0,
  );

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Trusted sources</h1>
        <p className="text-muted-foreground text-sm">
          {sources.length} sources registered · {active.length} active ·{' '}
          {inactive.length} inactive · {autoCreated} auto-created ·{' '}
          {totalRecords.toLocaleString()} sales records linked.
        </p>
      </header>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">
            Active
            <Badge variant="secondary" className="ml-1.5">
              {active.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="inactive">
            Inactive
            <Badge variant="secondary" className="ml-1.5">
              {inactive.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active">
          <SourcesTable
            sources={active}
            emptyMessage="No active trusted sources."
          />
        </TabsContent>
        <TabsContent value="inactive">
          <SourcesTable
            sources={inactive}
            emptyMessage="No inactive trusted sources."
          />
        </TabsContent>
      </Tabs>

      <Card>
        <CardContent className="text-muted-foreground pt-6 text-sm">
          Auto-created entries appear with an{' '}
          <span className="font-semibold">auto</span> badge and default to tier{' '}
          <span className="font-mono">MEDIA</span>. Review them after the
          ingestion pipeline discovers a new host and change the tier if
          appropriate. Inactive hosts are skipped by Perplexity and RSS ingest.
        </CardContent>
      </Card>
    </div>
  );
}
