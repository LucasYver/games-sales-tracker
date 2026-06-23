import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { adminFetch, type AdminPublisherSummary } from '@/lib/admin';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { LauncherProfileBadge } from '../_components/LauncherProfileBadge';
import { PublisherBackfillButton } from '../_components/PublisherBackfillButton';

export const dynamic = 'force-dynamic';

export default async function AdminPublishersPage() {
  const publishers = await adminFetch<AdminPublisherSummary[]>('/publishers');

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Publishers</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Curated registry of big publishers whose PC distribution profile
            deviates from the Steam-default. Games whose IGDB publisher matches
            one of these entries inherit the profile via the
            <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-xs">
              Game.publisherId
            </code>
            FK. The profile is captured here but not yet consumed by the
            estimation engine.
          </p>
        </div>
        <PublisherBackfillButton />
      </header>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Profile</TableHead>
              <TableHead className="text-right">Games</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {publishers.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell>
                  <LauncherProfileBadge profile={p.launcherProfile} />
                </TableCell>
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
                    href={`/admin/publishers/${p.id}`}
                    className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                  >
                    Open
                    <ChevronRight aria-hidden="true" className="size-3" />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {publishers.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-muted-foreground py-12 text-center"
                >
                  No curated publishers yet. Restart the backend to seed the
                  canonical list.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Card>
        <CardContent className="text-muted-foreground pt-6 text-sm">
          To add a new big publisher, update
          <code className="bg-muted mx-1 rounded px-1 py-0.5 font-mono text-xs">
            backend/src/publishers/publishers.seed.ts
          </code>
          and restart the backend. The seed is idempotent and never overwrites
          a profile you have edited here.
        </CardContent>
      </Card>
    </div>
  );
}
