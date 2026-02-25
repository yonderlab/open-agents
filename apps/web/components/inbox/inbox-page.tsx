"use client";

import {
  AlertCircle,
  CheckCircle2,
  Circle,
  GitPullRequest,
  Loader2,
  MessageCircleQuestion,
  Plus,
  Search,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SandboxType } from "@/components/sandbox-selector-compact";
import { SessionStarter } from "@/components/session-starter";
import { UserAvatarDropdown } from "@/components/user-avatar-dropdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useCliTokens } from "@/hooks/use-cli-tokens";
import { useInbox } from "@/hooks/use-inbox";
import type {
  InboxActionType,
  InboxEventType,
  InboxItem,
} from "@/lib/inbox/types";
import { cn } from "@/lib/utils";

type InboxFilter =
  | "all"
  | "action_required"
  | "review_ready"
  | "no_output"
  | "updates";

interface InboxPageProps {
  lastRepo: { owner: string; repo: string } | null;
}

function formatTimeAgo(dateIso: string): string {
  const timestamp = new Date(dateIso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - timestamp);
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(dateIso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getEventIcon(eventType: InboxEventType) {
  switch (eventType) {
    case "question_asked":
      return <MessageCircleQuestion className="h-4 w-4 text-amber-500" />;
    case "approval_requested":
      return <ShieldAlert className="h-4 w-4 text-amber-500" />;
    case "run_failed":
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case "review_ready":
      return <GitPullRequest className="h-4 w-4 text-emerald-500" />;
    case "run_completed_no_output":
      return <TriangleAlert className="h-4 w-4 text-yellow-500" />;
    case "running_update":
      return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }
}

function getSessionLabel(item: InboxItem): string {
  const parts = [
    item.session.repoOwner,
    item.session.repoName,
    item.session.branch,
  ].filter((value): value is string => Boolean(value && value.length > 0));

  if (parts.length === 0) {
    return item.session.title;
  }

  return parts.join("/");
}

function getFilterCount(
  filter: InboxFilter,
  counts: {
    actionRequired: number;
    reviewReady: number;
    noOutput: number;
    updates: number;
    total: number;
  } | null,
): number {
  if (!counts) return 0;

  switch (filter) {
    case "all":
      return counts.total;
    case "action_required":
      return counts.actionRequired;
    case "review_ready":
      return counts.reviewReady;
    case "no_output":
      return counts.noOutput;
    case "updates":
      return counts.updates;
  }
}

function filterButtonLabel(filter: InboxFilter): string {
  switch (filter) {
    case "all":
      return "All";
    case "action_required":
      return "Action Required";
    case "review_ready":
      return "Review Ready";
    case "no_output":
      return "No Output";
    case "updates":
      return "Running";
  }
}

export function InboxPage({ lastRepo }: InboxPageProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<InboxFilter>("all");
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const includeUpdates = activeFilter === "updates";

  const { data, loading, error, refresh, runAction } = useInbox({
    q: query,
    includeUpdates,
  });

  const groups = useMemo(() => {
    if (!data) {
      return {
        actionRequired: [] as InboxItem[],
        reviewReady: [] as InboxItem[],
        noOutput: [] as InboxItem[],
        updates: [] as InboxItem[],
      };
    }

    const removeDismissed = (items: InboxItem[]) =>
      items.filter((item) => !dismissedIds.has(item.id));

    return {
      actionRequired: removeDismissed(data.groups.actionRequired),
      reviewReady: removeDismissed(data.groups.reviewReady),
      noOutput: removeDismissed(data.groups.noOutput),
      updates: removeDismissed(data.groups.updates),
    };
  }, [data, dismissedIds]);

  const visibleSections = useMemo(() => {
    switch (activeFilter) {
      case "all":
        return [
          {
            key: "actionRequired",
            title: "Action Required",
            items: groups.actionRequired,
          },
          {
            key: "reviewReady",
            title: "Review Ready",
            items: groups.reviewReady,
          },
          { key: "noOutput", title: "No Output", items: groups.noOutput },
        ];
      case "action_required":
        return [
          {
            key: "actionRequired",
            title: "Action Required",
            items: groups.actionRequired,
          },
        ];
      case "review_ready":
        return [
          {
            key: "reviewReady",
            title: "Review Ready",
            items: groups.reviewReady,
          },
        ];
      case "no_output":
        return [
          { key: "noOutput", title: "No Output", items: groups.noOutput },
        ];
      case "updates":
        return [{ key: "updates", title: "Running", items: groups.updates }];
    }
  }, [activeFilter, groups]);

  const totalVisibleItems =
    groups.actionRequired.length +
    groups.reviewReady.length +
    groups.noOutput.length +
    groups.updates.length;

  const hasAnyVisibleItems = totalVisibleItems > 0;

  const countOverrides = useMemo(() => {
    if (!data) return null;

    return {
      actionRequired: groups.actionRequired.length,
      reviewReady: groups.reviewReady.length,
      noOutput: groups.noOutput.length,
      updates: groups.updates.length,
      total:
        groups.actionRequired.length +
        groups.reviewReady.length +
        groups.noOutput.length +
        groups.updates.length,
    };
  }, [data, groups]);

  const handleCreateSession = async (input: {
    repoOwner?: string;
    repoName?: string;
    branch?: string;
    cloneUrl?: string;
    isNewBranch: boolean;
    sandboxType: SandboxType;
  }) => {
    setIsCreating(true);
    setCreateError(null);

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoOwner: input.repoOwner,
          repoName: input.repoName,
          branch: input.branch,
          cloneUrl: input.cloneUrl,
          isNewBranch: input.isNewBranch,
          sandboxType: input.sandboxType,
        }),
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error ?? "Failed to create session");
      }

      setIsTaskDialogOpen(false);
      await refresh();
    } catch (createSessionError) {
      setCreateError(
        createSessionError instanceof Error
          ? createSessionError.message
          : "Failed to create session",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleAction = async (item: InboxItem, actionType: InboxActionType) => {
    try {
      if (actionType === "mark_done") {
        await runAction({ itemId: item.id, action: "mark_done" });
        setDismissedIds((previous) => new Set([...previous, item.id]));
        return;
      }

      const response = await runAction({
        itemId: item.id,
        action: "open_session",
        payload: {
          sessionUrl: item.links.sessionUrl,
        },
      });

      router.push(response.redirectUrl ?? item.links.sessionUrl);
    } catch (actionError) {
      console.error("Inbox action failed:", actionError);
      if (actionType === "open_session") {
        router.push(item.links.sessionUrl);
      }
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="border-b px-4 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-lg font-semibold">Open Harness</p>
            <p className="text-sm text-muted-foreground">
              Inbox-only triage for concurrent sessions
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Dialog open={isTaskDialogOpen} onOpenChange={setIsTaskDialogOpen}>
              <Button onClick={() => setIsTaskDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                New Task
              </Button>
              <DialogContent className="max-w-2xl border-border/60 bg-neutral-950 p-0 sm:max-w-2xl">
                <DialogHeader className="px-6 pt-6">
                  <DialogTitle>Dispatch a new task</DialogTitle>
                  <DialogDescription>
                    Start a session and return to Inbox while it runs.
                  </DialogDescription>
                </DialogHeader>
                <div className="px-6 pb-6">
                  <SessionStarter
                    onSubmit={handleCreateSession}
                    isLoading={isCreating}
                    lastRepo={lastRepo}
                  />
                  {createError ? (
                    <p className="mt-3 text-sm text-destructive">
                      {createError}
                    </p>
                  ) : null}
                </div>
              </DialogContent>
            </Dialog>
            <UserAvatarDropdown />
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="pl-9"
              placeholder="Search by title, repo, or branch"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {(
              [
                "all",
                "action_required",
                "review_ready",
                "no_output",
                "updates",
              ] as InboxFilter[]
            ).map((filter) => {
              const isActive = activeFilter === filter;
              const count = getFilterCount(filter, countOverrides);

              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setActiveFilter(filter)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
                    isActive
                      ? "border-foreground/30 bg-muted text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span>{filterButtonLabel(filter)}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-6 sm:px-6">
        <CliConnectBanner />

        {error ? (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            Failed to load inbox: {error.message}
          </div>
        ) : null}

        {loading && !data ? (
          <InboxLoadingState />
        ) : hasAnyVisibleItems ? (
          <div className="space-y-6">
            {visibleSections.map((section) => (
              <section key={section.key} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {section.title}
                  </h2>
                  <span className="text-xs text-muted-foreground">
                    {section.items.length}
                  </span>
                </div>

                {section.items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                    Nothing here right now.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {section.items.map((item) => {
                      const primaryAction =
                        item.actions.find((action) => action.primary) ??
                        item.actions[0];

                      return (
                        <article
                          key={item.id}
                          className="rounded-lg border border-border/70 bg-card/60 px-4 py-3"
                        >
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                {getEventIcon(item.eventType)}
                                <p className="truncate font-medium">
                                  {item.title}
                                </p>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {getSessionLabel(item)}
                              </p>
                              <p className="mt-2 text-sm text-muted-foreground">
                                {item.preview}
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                {item.badges.hasStreaming ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    Running
                                  </span>
                                ) : null}
                                {item.badges.hasUnread ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5">
                                    <Circle className="h-2.5 w-2.5 fill-current" />
                                    Unread
                                  </span>
                                ) : null}
                                {(item.badges.linesAdded ?? 0) > 0 ? (
                                  <span className="font-mono text-emerald-600 dark:text-emerald-400">
                                    +{item.badges.linesAdded}
                                  </span>
                                ) : null}
                                {(item.badges.linesRemoved ?? 0) > 0 ? (
                                  <span className="font-mono text-rose-600 dark:text-rose-400">
                                    -{item.badges.linesRemoved}
                                  </span>
                                ) : null}
                                {item.badges.prStatus ? (
                                  <span className="rounded-md bg-muted px-2 py-0.5">
                                    PR {item.badges.prStatus}
                                  </span>
                                ) : null}
                              </div>
                            </div>

                            <span className="shrink-0 text-xs text-muted-foreground">
                              {formatTimeAgo(item.updatedAt)}
                            </span>
                          </div>

                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            {primaryAction ? (
                              <Button
                                size="sm"
                                onClick={() =>
                                  void handleAction(item, primaryAction.type)
                                }
                              >
                                {primaryAction.label}
                              </Button>
                            ) : null}
                            {item.actions
                              .filter((action) => !action.primary)
                              .map((action) => (
                                <Button
                                  key={action.type}
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    void handleAction(item, action.type)
                                  }
                                >
                                  {action.label}
                                </Button>
                              ))}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => router.push(item.links.sessionUrl)}
                            >
                              Open full session
                            </Button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <InboxEmptyState />
        )}
      </main>
    </div>
  );
}

function InboxLoadingState() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={`inbox-loading-${index}`}
          className="h-28 animate-pulse rounded-lg border border-border/70 bg-muted/30"
        />
      ))}
    </div>
  );
}

function InboxEmptyState() {
  return (
    <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 px-6 text-center">
      <CheckCircle2 className="h-8 w-8 text-muted-foreground" />
      <p className="mt-3 text-base font-medium">No action needed</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">
        All current sessions are either parked or waiting without any actions on
        you.
      </p>
    </div>
  );
}

function CliConnectBanner() {
  const { tokens, loading } = useCliTokens();

  if (loading || tokens.length > 0) {
    return null;
  }

  return (
    <div className="mb-4 inline-flex items-center gap-3 rounded-full border border-border/60 bg-muted/70 px-4 py-1.5 text-sm text-muted-foreground">
      <span className="text-foreground">
        Run sessions locally with the CLI.
      </span>
      <Link
        href="/settings/tokens"
        className="text-foreground underline decoration-foreground/40 underline-offset-4 transition hover:decoration-foreground"
      >
        Set up CLI
      </Link>
    </div>
  );
}
