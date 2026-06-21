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

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Trusted sources</h1>
        <p className="text-muted-foreground text-sm">
          {sources.length} sources registered · {active.length} active ·{' '}
          {inactive.length} inactive.
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
              <TableHead>Capabilities</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((ts) => (
              <TableRow key={ts.id}>
                <TableCell>
                  <div className="font-medium">{ts.name}</div>
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
                  colSpan={9}
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
          To add a new source, update the seed registry on the backend and
          re-run the seeder. CRUD-style creation from the UI is not yet wired.
        </CardContent>
      </Card>
    </div>
  );
}
