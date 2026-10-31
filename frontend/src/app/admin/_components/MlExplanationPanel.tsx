import type { AdminMlExplanation } from '@/lib/admin';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return Math.round(n).toLocaleString('en-US');
}

function fmtFactor(f: number): string {
  return `×${f.toFixed(2)}`;
}

function fmtValue(v: number | string | null): string {
  if (v === null) return '—';
  return typeof v === 'number' ? v.toLocaleString('en-US') : v;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/** Factor cell: green when it raises the estimate, red when it lowers it. */
function FactorCell({ factor }: { factor: number }) {
  return (
    <TableCell
      className={cn(
        'text-right tabular-nums',
        factor > 1.02 && 'text-emerald-600 dark:text-emerald-400',
        factor < 0.98 && 'text-red-600 dark:text-red-400',
      )}
    >
      {fmtFactor(factor)}
    </TableCell>
  );
}

/**
 * How the worldwide ML estimate was computed: why it is (not) shown, the
 * exact split by family of inputs, and the inputs.
 */
export function MlExplanationPanel({
  explanation: e,
  shown,
  hiddenOnSite,
  siteUnits,
}: {
  explanation: AdminMlExplanation;
  shown: boolean;
  hiddenOnSite: boolean;
  siteUnits: number | null;
}) {
  const reasons: string[] = [];
  if (!e.estimate) {
    reasons.push(
      `no ML estimate before ${e.rule.minDaysAfterRelease} days after the PC release (or without a PC release date)`,
    );
  } else if (!shown) {
    if (siteUnits !== null && siteUnits < e.rule.minSiteUnits) {
      reasons.push(
        `platform sum ${fmt(siteUnits)} is below ${fmt(e.rule.minSiteUnits)}`,
      );
    }
    if ((e.steamReviews ?? 0) < e.rule.minSteamReviews) {
      reasons.push(
        `${fmtValue(e.steamReviews ?? 0)} Steam reviews, below ${e.rule.minSteamReviews.toLocaleString('en-US')}`,
      );
    }
  }
  const d = e.decomposition;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold tracking-wide uppercase">
          ML model
          {e.estimate ? ` — how ${fmt(e.estimate.units)} is computed` : ''}
          <Badge variant="secondary">model {e.modelVersion}</Badge>
          {e.estimate && (
            <Badge variant={shown ? 'default' : 'outline'}>
              {shown ? 'Shown on site' : 'Not shown'}
            </Badge>
          )}
        </CardTitle>
        <p className="text-muted-foreground text-xs">
          {hiddenOnSite
            ? 'The public site shows no estimate: this game was released before 2017.'
            : shown
              ? 'The public site displays this estimate.'
              : `The public site shows the platform sum instead: ${reasons.join('; ') || 'outside the zone the model was tested on'}.`}{' '}
          It is shown only for games the platform sum puts at{' '}
          {fmt(e.rule.minSiteUnits)}+ with{' '}
          {e.rule.minSteamReviews.toLocaleString('en-US')}+ Steam reviews,
          from {e.rule.minDaysAfterRelease} days after the PC release.
        </p>
      </CardHeader>
      {e.estimate && d && (
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide uppercase">
              From a typical game to the estimate
            </h3>
            <p className="text-muted-foreground text-xs">
              Two models are averaged (geometric mean): a random forest of 300
              decision trees and a linear model. Both start from a typical game
              of the training set; each family of inputs then multiplies the
              figure. The effects are exact: start × effects = estimate.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Inputs</TableHead>
                  <TableHead className="text-right">Forest</TableHead>
                  <TableHead className="text-right">Linear</TableHead>
                  <TableHead className="text-right">Model</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell className="text-muted-foreground">
                    Typical game (start)
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(d.start.forest)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(d.start.ridge)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(d.start.average)}
                  </TableCell>
                </TableRow>
                {d.families.map((f) => (
                  <TableRow key={f.family}>
                    <TableCell>{f.family}</TableCell>
                    <FactorCell factor={f.forest} />
                    <FactorCell factor={f.ridge} />
                    <FactorCell factor={f.average} />
                  </TableRow>
                ))}
                <TableRow className="font-semibold">
                  <TableCell>Estimate on {day(e.asOf)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(d.result.forest)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(d.result.ridge)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(d.result.average)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
            <p className="text-muted-foreground text-xs">
              Range shown: {fmt(e.estimate.low)} – {fmt(e.estimate.high)}{' '}
              (estimate ÷/× {e.halfWidthFactor.toFixed(2)}, which held the
              published figure about 8 times out of 10 on unseen games).
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold tracking-wide uppercase">
              Inputs on {day(e.asOf)}
            </h3>
            <Table>
              <TableBody>
                {e.inputs.map((i) => (
                  <TableRow key={i.label}>
                    <TableCell className="text-muted-foreground">
                      {i.label}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtValue(i.value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
