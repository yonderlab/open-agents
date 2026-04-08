"use client";

import { PatchDiff } from "@pierre/diffs/react";
import {
  ArrowLeft,
  FileText,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { DiffFile } from "@/app/api/sessions/[sessionId]/diff/route";
import { useGitPanel } from "./git-panel-context";
import { Button } from "@/components/ui/button";
import {
  type DiffMode,
  useUserPreferences,
} from "@/hooks/use-user-preferences";
import { useIsMobile } from "@/hooks/use-mobile";
import { defaultDiffOptions, splitDiffOptions } from "@/lib/diffs-config";
import { cn } from "@/lib/utils";
import { useSessionChatWorkspaceContext } from "./session-chat-context";

type DiffStyle = DiffMode;

const wrappedDiffExtensions = new Set([".md", ".mdx", ".markdown", ".txt"]);

function shouldWrapDiffContent(filePath: string) {
  const normalizedPath = filePath.toLowerCase();
  return [...wrappedDiffExtensions].some((extension) =>
    normalizedPath.endsWith(extension),
  );
}

function formatTimestamp(date: Date) {
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StaleBanner({ cachedAt }: { cachedAt: Date | null }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-amber-100 px-4 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
      <span>
        Viewing cached changes - sandbox is offline
        {cachedAt && (
          <span className="text-amber-700/70 dark:text-amber-400/70">
            {" "}
            (saved {formatTimestamp(cachedAt)})
          </span>
        )}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: DiffFile["status"] }) {
  const styles = {
    added: "bg-green-500/20 text-green-700 dark:text-green-400",
    modified: "bg-blue-500/20 text-blue-700 dark:text-blue-400",
    deleted: "bg-red-500/20 text-red-700 dark:text-red-400",
    renamed: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400",
  };

  const labels = {
    added: "New",
    modified: "Modified",
    deleted: "Deleted",
    renamed: "Renamed",
  };

  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium uppercase",
        styles[status],
      )}
    >
      {labels[status]}
    </span>
  );
}

/**
 * Shows a single file's diff, opened from the git panel's diff file list.
 * No multi-file view, no collapse — just the file header + patch.
 */
export function DiffTabView() {
  const {
    diff,
    diffLoading,
    diffRefreshing,
    diffError,
    diffCachedAt,
    sandboxInfo,
    refreshDiff,
  } = useSessionChatWorkspaceContext();
  const { focusedDiffFile, setFocusedDiffFile, setActiveView } = useGitPanel();
  const isMobile = useIsMobile();
  const { preferences } = useUserPreferences();
  const [diffStyle, setDiffStyle] = useState<DiffStyle>("unified");

  // Find the focused file in the diff data
  const file = useMemo(() => {
    if (!diff || !focusedDiffFile) return null;
    return diff.files.find((f) => f.path === focusedDiffFile) ?? null;
  }, [diff, focusedDiffFile]);

  const showStaleIndicator = !sandboxInfo && diff !== null;

  useEffect(() => {
    if (isMobile) {
      setDiffStyle("unified");
      return;
    }
    setDiffStyle(preferences?.defaultDiffMode ?? "unified");
  }, [isMobile, preferences?.defaultDiffMode]);

  const baseOptions =
    diffStyle === "split" ? splitDiffOptions : defaultDiffOptions;

  const handleBack = () => {
    setActiveView("chat");
  };

  // If there's no focused file yet (e.g. user clicked the diff tab directly), show a placeholder
  if (!focusedDiffFile) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <FileText className="h-8 w-8" />
        <p className="text-sm">Select a file from the Diff panel to view changes</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 px-0"
            onClick={handleBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          {file && (
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate text-sm font-medium">
                {file.path}
              </span>
              <StatusBadge status={file.status} />
              <div className="flex items-center gap-1.5 text-xs">
                {file.additions > 0 && (
                  <span className="text-green-600 dark:text-green-500">
                    +{file.additions}
                  </span>
                )}
                {file.deletions > 0 && (
                  <span className="text-red-600 dark:text-red-400">
                    -{file.deletions}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refreshDiff()}
            disabled={diffRefreshing || !sandboxInfo}
            className="h-7 px-2 text-xs"
            title="Refresh diff"
          >
            <RefreshCw
              className={cn("h-3 w-3", diffRefreshing && "animate-spin")}
            />
          </Button>
          <div className="hidden items-center rounded-md border border-border md:flex">
            <button
              type="button"
              onClick={() => setDiffStyle("unified")}
              className={cn(
                "rounded-l-md px-2.5 py-1 text-xs font-medium transition-colors",
                diffStyle === "unified"
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Unified
            </button>
            <button
              type="button"
              onClick={() => setDiffStyle("split")}
              className={cn(
                "rounded-r-md px-2.5 py-1 text-xs font-medium transition-colors",
                diffStyle === "split"
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Split
            </button>
          </div>
        </div>
      </div>

      {showStaleIndicator ? <StaleBanner cachedAt={diffCachedAt} /> : null}

      {/* Content */}
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          showStaleIndicator && "opacity-90",
        )}
      >
        {diffLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {diffError && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-red-600 dark:text-red-400">
              {diffError}
            </p>
          </div>
        )}

        {!diffLoading && !diffError && !file && (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              File not found in diff
            </p>
          </div>
        )}

        {!diffLoading && !diffError && file && (
          <div>
            {file.generated ? (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                Generated file — diff content hidden
              </div>
            ) : file.diff ? (
              <PatchDiff
                key={`${file.path}-${diffStyle}`}
                patch={file.diff}
                options={
                  shouldWrapDiffContent(file.path)
                    ? { ...baseOptions, overflow: "wrap" as const }
                    : baseOptions
                }
              />
            ) : (
              <div className="px-4 py-6 text-center text-xs text-muted-foreground">
                No diff content available
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
