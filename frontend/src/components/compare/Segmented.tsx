'use client';

/** A row of toggle buttons where exactly one is on (chart and table options). */
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
  return (
    <div className="flex items-center gap-2">
      {showLabel && (
        <span className="font-mono text-[0.68rem] text-muted-foreground">{label}</span>
      )}
      <div
        role="group"
        aria-label={label}
        className="flex flex-wrap overflow-hidden rounded-[3px] border border-border"
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
              className={`h-9 px-3 font-mono text-xs transition-colors ${
                i > 0 ? 'border-l border-border' : ''
              } ${
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
