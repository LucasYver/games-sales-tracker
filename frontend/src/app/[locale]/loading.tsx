/**
 * Skeleton shown during navigation (filter / page change). Mirrors the
 * listing layout — header bar, sort nav, table rows — so nothing reflows when
 * the data arrives. Only the rows pulse; the shell renders instantly.
 */
export default function HomeLoading() {
  return (
    <main className="flex flex-col">
      <div className="border-b border-border bg-card">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3">
          <div className="h-5 w-40 animate-pulse rounded-[2px] bg-muted" />
          <div className="ml-auto h-9 w-56 animate-pulse rounded-[2px] bg-muted" />
        </div>
      </div>
      <div className="flex gap-1 border-b border-border bg-surface-alt px-4 py-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-6 w-28 animate-pulse rounded-[2px] bg-muted"
          />
        ))}
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 py-5">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-6">
          <div className="min-w-0 flex-1">
            <div className="mb-4 h-5 w-52 animate-pulse rounded-[2px] bg-muted" />
            <div className="border-t border-border">
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 border-b border-border-soft px-2 py-2.5 odd:bg-surface-alt"
                >
                  <div className="size-8 shrink-0 animate-pulse rounded-[2px] bg-muted" />
                  <div className="h-4 flex-1 animate-pulse rounded-[2px] bg-muted" />
                  <div className="h-4 w-16 shrink-0 animate-pulse rounded-[2px] bg-muted" />
                </div>
              ))}
            </div>
          </div>
          <div className="hidden h-80 w-72 shrink-0 animate-pulse rounded-[2px] bg-muted lg:block" />
        </div>
      </div>
    </main>
  );
}
