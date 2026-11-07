import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { adminFetch, type AdminDeveloperSummary } from '@/lib/admin';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DeveloperBackfillButton } from '../_components/DeveloperBackfillButton';

export const dynamic = 'force-dynamic';

export default async function AdminDevelopersPage() {
  const developers = await adminFetch<AdminDeveloperSummary[]>('/developers');

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Developers</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Every studio a game names as developer, one row per company, most
            games first. Ingestion and the nightly IGDB refresh create the row
            of a new studio and link its games via the
            <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-xs">
              Game.developerId
            </code>
            FK. The public studio pages group games by it.
          </p>
        </div>
        <DeveloperBackfillButton />
      </header>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Games</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {developers.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {p.gameCount}
                </TableCell>
                <TableCell className="text-muted-foreground text-xs">
                  {new Date(p.updatedAt).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/admin/developers/${p.id}`}
                    className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                  >
                    Open
                    <ChevronRight aria-hidden="true" className="size-3" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {developers.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-muted-foreground py-12 text-center"
                >
                  No developers yet. Restart the backend to link the games.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardContent className="text-muted-foreground pt-6 text-sm">
          New studios are added on their own. To fold a studio&apos;s other
          names (an internal division, a legal name) into one row, add an alias
          to
          <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-xs">
            COMPANY_ALIASES
          </code>
          in
          <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-xs">
            backend/src/games/game-companies.ts
          </code>
          and re-link the games.
        </CardContent>
      </Card>
    </div>
  );
}
