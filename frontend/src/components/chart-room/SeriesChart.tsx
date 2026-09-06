'use client';

import { useRef, useState } from 'react';
import { useFormatter } from 'next-intl';
import type { ReviewPoint } from '@/lib/api';
import {
  BASELINE,
  PLOT_LEFT,
  PLOT_RIGHT,
  VB_H,
  VB_W,
  downsample,
  niceMax,
  scaleX,
  scaleY,
} from '@/lib/chart';

export type SeriesKind = 'count' | 'money';

/**
 * A measured series over time (reviews, concurrent players, price…). These are
 * observed on a schedule, so a continuous line is honest here — unlike sales,
 * which we only know at the dates a figure was published.
 *
 * Money series are drawn as steps: a price holds until the next observation,
 * it does not drift between two captures.
 *
 * Hovering reads out the nearest observation — its exact value and date —
 * because a shape alone never answers "how much, and when".
 */
export function SeriesChart({
  points,
  label,
  ariaLabel,
  kind = 'count',
  currency = 'USD',
}: {
  points: ReviewPoint[];
  /** Omit when the surrounding UI already names the series (e.g. tabs). */
  label?: string;
  ariaLabel: string;
  kind?: SeriesKind;
  /** ISO code for money series; amounts are expected in cents. */
  currency?: string;
}) {
  const format = useFormatter();
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const clean = downsample(
    points
      .map((p) => ({ t: new Date(p.capturedAt).getTime(), v: p.value }))
      .filter((p) => Number.isFinite(p.t) && p.v > 0)
      .sort((a, b) => a.t - b.t),
  );

  if (clean.length < 2) return null;

  const tMin = clean[0].t;
  const tMax = clean[clean.length - 1].t;
  const max = niceMax(Math.max(...clean.map((p) => p.v)));

  const coords = clean.map((p) => ({
    x: scaleX(p.t, tMin, tMax),
    y: scaleY(p.v, max),
  }));

  // Steps for money, a plain polyline otherwise.
  const line =
    kind === 'money'
      ? coords
          .flatMap((c, i) =>
            i === 0 ? [c] : [{ x: c.x, y: coords[i - 1].y }, c],
          )
          .map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`)
      : coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`);
  const area = `M${line.join(' L')} L${PLOT_RIGHT},${BASELINE} L${PLOT_LEFT},${BASELINE} Z`;
  const last = coords[coords.length - 1];

  const ticks = [0, max / 2, max];
  const value = (n: number) =>
    kind === 'money'
      ? format.number(n / 100, {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
        })
      : format.number(n, { notation: 'compact', maximumFractionDigits: 1 });
  const exactValue = (n: number) =>
    kind === 'money'
      ? format.number(n / 100, { style: 'currency', currency })
      : format.number(n);
  const month = (t: number) =>
    format.dateTime(new Date(t), { year: 'numeric', month: 'short' });
  const fullDay = (t: number) =>
    format.dateTime(new Date(t), {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

  /** Nearest observation to the pointer, in viewBox space. */
  const trackPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const vbX = ((event.clientX - rect.left) / rect.width) * VB_W;
    let nearest = 0;
    for (let i = 1; i < coords.length; i++) {
      if (Math.abs(coords[i].x - vbX) < Math.abs(coords[nearest].x - vbX)) {
        nearest = i;
      }
    }
    setHover(nearest);
  };

  const active = hover != null ? coords[hover] : null;
  const activePoint = hover != null ? clean[hover] : null;
  // Keep the readout inside the frame instead of letting it hang off an edge.
  const tooltipLeft = active
    ? Math.min(92, Math.max(8, (active.x / VB_W) * 100))
    : 0;

  return (
    <figure className="m-0 flex flex-col gap-2">
      {label && (
        <figcaption className="font-mono text-[0.7rem] tracking-wider text-muted-foreground uppercase">
          {label}
        </figcaption>
      )}
      <div className="relative border border-border bg-surface-alt p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="h-auto w-full"
          role="img"
          aria-label={ariaLabel}
          onPointerMove={trackPointer}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PLOT_LEFT}
                x2={PLOT_RIGHT}
                y1={scaleY(tick, max)}
                y2={scaleY(tick, max)}
                stroke={tick === 0 ? 'var(--border)' : 'var(--border-soft)'}
                strokeWidth="1"
              />
              <text
                x={PLOT_LEFT - 8}
                y={scaleY(tick, max) + 3.5}
                textAnchor="end"
                className="fill-muted-foreground font-mono text-[10px]"
              >
                {value(tick)}
              </text>
            </g>
          ))}

          <path d={area} fill="var(--primary)" fillOpacity="0.14" />
          <polyline
            points={line.join(' ')}
            fill="none"
            stroke="var(--primary)"
            strokeWidth="2.2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <circle
            cx={last.x}
            cy={last.y}
            r="4"
            fill="var(--primary)"
            stroke="var(--background)"
            strokeWidth="1.5"
          />

          {active && (
            <g pointerEvents="none">
              <line
                x1={active.x}
                x2={active.x}
                y1={0}
                y2={BASELINE}
                stroke="var(--muted-foreground)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={active.x}
                cy={active.y}
                r="5"
                fill="var(--primary)"
                stroke="var(--background)"
                strokeWidth="2"
              />
            </g>
          )}

          <text
            x={PLOT_LEFT}
            y={VB_H - 8}
            textAnchor="start"
            className="fill-text-faint font-mono text-[10px]"
          >
            {month(tMin)}
          </text>
          <text
            x={PLOT_RIGHT}
            y={VB_H - 8}
            textAnchor="end"
            className="fill-text-faint font-mono text-[10px]"
          >
            {month(tMax)}
          </text>
        </svg>

        {activePoint && (
          <div
            aria-hidden
            style={{ left: `${tooltipLeft}%` }}
            className="pointer-events-none absolute top-2 -translate-x-1/2 border border-border bg-card px-2 py-1 text-center shadow-lg"
          >
            <div className="font-mono text-sm font-bold tabular-nums">
              {exactValue(activePoint.v)}
            </div>
            <div className="font-mono text-[0.66rem] whitespace-nowrap text-muted-foreground">
              {fullDay(activePoint.t)}
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}
