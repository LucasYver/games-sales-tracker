'use client';

/**
 * Columns of the phone grid: up to three options sit on one row, more go two
 * by two (an odd last one spans the row), so every cell keeps the same width
 * and no border breaks where a row wraps.
 */
const PHONE_COLS = ['grid-cols-1', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'];

/**
 * A row of toggle buttons where exactly one is on (chart and table options).
 * On a phone the label sits above a full-width grid of equal cells; from the
 * `sm` breakpoint it is the inline row it always was.
 */
export function Segmented<V extends string>({
  label,
  options,
  value,
  onChange,
  showLabel = false,
}: {
  label: string;
  options: { value: V; label: string }[];
  value: V;
  onChange: (value: V) => void;
  /** Print the label before the buttons, not only for screen readers. */
  showLabel?: boolean;
}) {
  const count = options.length;
  const cols = count <= 3 ? PHONE_COLS[count] : PHONE_COLS[2];
  const spanLast = count > 3 && count % 2 === 1;

  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
      {showLabel && (
        <span className="font-mono text-[0.68rem] text-muted-foreground">{label}</span>
      )}
      <div
        role="group"
        aria-label={label}
        className={`grid ${cols} overflow-hidden rounded-[3px] border-t border-l border-border sm:flex sm:flex-wrap sm:border-r sm:border-b`}
      >
        {options.map((o, i) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => {
                if (!on) onChange(o.value);
              }}
              className={`min-h-9 border-r border-b border-border px-2 py-1.5 font-mono text-xs leading-tight transition-colors sm:h-9 sm:border-r-0 sm:border-b-0 sm:px-3 sm:py-0 ${
                i > 0 ? 'sm:border-l' : ''
              } ${spanLast && i === count - 1 ? 'col-span-2' : ''} ${
                on
                  ? 'bg-accent text-accent-foreground'
                  : 'text-foreground hover:bg-surface-hi'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
