/**
 * Skeleton shown during navigation (filter / page change). Mirrors the
 * `Home` layout (hero + main listing + sticky filter sidebar) so the UI
 * doesn't reflow when data arrives. Only the listing grid and the sidebar
 * controls pulse; the static shell renders instantly.
 */
export default function HomeLoading() {
  return (
    <main className="flex flex-col">
      <section className="relative isolate overflow-hidden border-b border-border bg-gradient-to-b from-accent/40 to-background">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-32 left-1/2 -z-10 h-72 w-[60rem] -translate-x-1/2 rounded-full bg-primary/15 opacity-70 blur-3xl"
        />
        <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 pt-10 pb-14">
          <div className="bg-muted/60 h-5 w-44 animate-pulse rounded-md" />
          <div className="flex flex-col gap-4">
            <div className="bg-muted/60 h-12 w-3/4 animate-pulse rounded-lg" />
            <div className="bg-muted/60 h-5 w-2/3 animate-pulse rounded-md" />
          </div>
          <div className="bg-muted/60 h-11 w-full max-w-xl animate-pulse rounded-md" />
        </div>
      </section>

      <div className="mx-auto w-full max-w-7xl px-6 py-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:gap-8">
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <div className="bg-muted/60 h-7 w-56 animate-pulse rounded-md" />
                <div className="bg-muted/60 h-4 w-24 animate-pulse rounded-md" />
              </div>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 9 }).map((_, i) => (
                  <SkeletonCard key={i} />
                ))}
              </div>
            </div>
          </div>

          <aside className="border-border/60 bg-card/60 sticky top-6 hidden h-fit w-72 shrink-0 rounded-xl border p-5 shadow-sm lg:block">
            <div className="flex flex-col gap-5">
              <div className="bg-muted/60 h-5 w-20 animate-pulse rounded" />
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <div className="bg-muted/60 h-3 w-16 animate-pulse rounded" />
                  <div className="bg-muted/60 h-9 w-full animate-pulse rounded-md" />
                </div>
              ))}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function SkeletonCard() {
  return (
    <div className="ring-foreground/10 bg-card overflow-hidden rounded-xl ring-1">
      <div className="bg-muted/60 aspect-[460/215] w-full animate-pulse" />
      <div className="flex flex-col gap-2.5 p-4">
        <div className="bg-muted/60 h-4 w-3/4 animate-pulse rounded" />
        <div className="bg-muted/60 h-3 w-1/2 animate-pulse rounded" />
        <div className="mt-2 flex gap-1">
          <div className="bg-muted/60 h-4 w-10 animate-pulse rounded" />
          <div className="bg-muted/60 h-4 w-14 animate-pulse rounded" />
        </div>
      </div>
    </div>
  );
}
