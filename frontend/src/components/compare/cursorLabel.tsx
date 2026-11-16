import type { LabelProps } from 'recharts';

/**
 * Label content for a Recharts `ReferenceLine`: the month the panel above the
 * chart reads, written at the top of the hovered column instead of in the
 * panel, so the panel never changes height. Near either edge the text grows
 * inwards so it is never cut.
 *
 * `position` is where the line sits across the plot, from 0 (left) to 1 (right).
 */
export function cursorLabel(text: string, position: number) {
  const anchor = position > 0.75 ? 'end' : position < 0.25 ? 'start' : 'middle';
  const dx = anchor === 'end' ? -4 : anchor === 'start' ? 4 : 0;
  return function renderCursorLabel({ viewBox }: LabelProps) {
    // A reference line on a cartesian chart gets a cartesian box.
    if (!viewBox || !('x' in viewBox) || viewBox.x == null || viewBox.y == null) return null;
    return (
      <text
        x={viewBox.x + dx}
        y={viewBox.y - 8}
        textAnchor={anchor}
        className="fill-muted-foreground font-mono text-[11px]"
        stroke="var(--background)"
        strokeWidth={3}
        paintOrder="stroke"
      >
        {text}
      </text>
    );
  };
}
