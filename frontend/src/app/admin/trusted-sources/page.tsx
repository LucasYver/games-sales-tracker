import { ExternalLink, Rss, Search } from 'lucide-react';
import { adminFetch, type AdminTrustedSource } from '@/lib/admin';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DeleteButton } from '../_components/DeleteButton';
import { deleteTrustedSource } from '../actions';

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

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Tier</TableHead>
              <TableHead>Host / Handle</TableHead>
              <TableHead>Lang</TableHead>
              <TableHead className="text-right">Weight</TableHead>
              <TableHead className="text-right">Records</TableHead>
              <TableHead>Capabilities</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((ts) => (
              <TableRow key={ts.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{ts.name}</span>
                    {ts.autoCreated && (
                      <Badge
                        variant="outline"
                        className="border-amber-300 bg-amber-50 text-[10px] tracking-wide text-amber-800 uppercase dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
                        title="Auto-created by the ingestion pipeline. Review the tier and weight before relying on it."
                      >
                        auto
                      </Badge>
                    )}
                  </div>
                  <div className="text-muted-foreground font-mono text-xs">
                    {ts.slug}
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{ts.category}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{ts.salesSource}</Badge>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-xs">
                  {ts.host ?? (ts.handle ? `@${ts.handle}` : '—')}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {ts.language}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {ts.weight}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {ts.recordCount ? (
                    <span className="font-medium">
                      {ts.recordCount.toLocaleString()}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {ts.feedUrl && (
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Rss aria-hidden="true" className="size-3" />
                        RSS
                      </Badge>
                    )}
                    {ts.searchUrlTemplate && (
                      <Badge variant="outline" className="gap-1 text-xs">
                        <Search aria-hidden="true" className="size-3" />
                        Search
                      </Badge>
                    )}
                    {ts.url && (
                      <a
                        href={ts.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                      >
                        site
                        <ExternalLink aria-hidden="true" className="size-3" />
                      </a>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {ts.active ? (
                    <Badge>active</Badge>
                  ) : (
                    <Badge variant="outline">inactive</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <DeleteButton
                    action={deleteTrustedSource.bind(null, ts.id)}
                    confirmMessage={`Delete trusted source "${ts.name}"?`}
                    iconOnly
                    label={`Delete ${ts.name}`}
                  />
                </TableCell>
              </TableRow>
            ))}
            {sources.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="text-muted-foreground py-12 text-center"
                >
                  No trusted sources registered.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardContent className="text-muted-foreground pt-6 text-sm">
          Auto-created entries appear with an{' '}
          <span className="font-semibold">auto</span> badge and default to tier{' '}
          <span className="font-mono">MEDIA</span> / weight{' '}
          <span className="font-mono">40</span>. Review them after the ingestion
          pipeline discovers a new host and bump the weight or change the tier
          if appropriate.
        </CardContent>
      </Card>
    </div>
  );
}
