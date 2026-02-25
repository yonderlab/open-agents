"use client";

export function HomeSkeleton() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <div className="h-5 w-36 animate-pulse rounded bg-muted" />
            <div className="h-4 w-56 animate-pulse rounded bg-muted" />
          </div>
          <div className="flex items-center gap-2">
            <div className="h-9 w-24 animate-pulse rounded-md bg-muted" />
            <div className="h-9 w-9 animate-pulse rounded-full bg-muted" />
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="h-9 w-full max-w-md animate-pulse rounded-md bg-muted" />
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={`skeleton-chip-${index}`}
                className="h-8 w-24 animate-pulse rounded-md bg-muted"
              />
            ))}
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6">
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={`inbox-skeleton-${index}`}
              className="h-28 animate-pulse rounded-lg border border-border/70 bg-muted/30"
            />
          ))}
        </div>
      </main>
    </div>
  );
}
