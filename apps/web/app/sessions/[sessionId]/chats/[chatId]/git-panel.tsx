"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  FileText,
  FolderGit2,
  GitCommit,
  GitPullRequest,
  Loader2,
  Square,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DiffFile } from "@/app/api/sessions/[sessionId]/diff/route";
import type { MergeReadinessResponse } from "@/app/api/sessions/[sessionId]/merge-readiness/route";
import type { MergePullRequestResponse } from "@/app/api/sessions/[sessionId]/merge/route";
import type { Session } from "@/lib/db/schema";
import type {
  PullRequestCheckRun,
  PullRequestMergeMethod,
} from "@/lib/github/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CheckRunsList } from "@/components/merge-check-runs";
import { cn } from "@/lib/utils";
import { useGitPanel } from "./git-panel-context";
import type { DevServerControls } from "./hooks/use-dev-server";
import type { CodeEditorControls } from "./hooks/use-code-editor";

/* ------------------------------------------------------------------ */
/* Merge method labels / descriptions                                  */
/* ------------------------------------------------------------------ */

const mergeMethodLabels: Record<PullRequestMergeMethod, string> = {
  squash: "Squash and merge",
  merge: "Create a merge commit",
  rebase: "Rebase and merge",
};

const mergeMethodButtonLabels: Record<PullRequestMergeMethod, string> = {
  squash: "Squash & Archive",
  merge: "Merge & Archive",
  rebase: "Rebase & Archive",
};

const mergeMethodDescriptions: Record<PullRequestMergeMethod, string> = {
  squash: "Combine all commits into one commit in the base branch.",
  merge: "All commits will be added to the base branch via a merge commit.",
  rebase: "All commits will be rebased and added to the base branch.",
};

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type GitPanelProps = {
  session: Session;
  // Git state
  hasRepo: boolean;
  hasExistingPr: boolean;
  existingPrUrl: string | null;
  canCreatePr: boolean;
  isCreatePrBranchReady: boolean;
  showCommitAction: boolean;
  commitActionLabel: string;
  hasUncommittedGitChanges: boolean;
  canMergeAndArchive: boolean;
  supportsRepoCreation: boolean;
  supportsDiff: boolean;
  hasDiff: boolean;

  // Auto-commit
  isAutoCommitting: boolean;
  isChatReady: boolean;

  // Preview/deployment
  prDeploymentUrl: string | null;
  isDeploymentStale: boolean;
  buildingDeploymentUrl: string | null;

  // Sandbox
  canRunDevServer: boolean;
  devServer: DevServerControls;
  codeEditor: CodeEditorControls;

  // Diff data
  diffFiles: DiffFile[] | null;
  diffSummary?: {
    totalAdditions: number;
    totalDeletions: number;
  } | null;

  // Actions
  onCommitClick: () => void;
  onCreatePrClick: () => void;
  onCreateRepoClick: () => void;
  onOpenPreview: () => void;
  onOpenPr: () => void;
  onOpenBuildingDeployment: () => void;

  // Merge
  onMerged: (result: MergePullRequestResponse) => Promise<void> | void;
  onFixChecks?: (failedRuns: PullRequestCheckRun[]) => Promise<void> | void;
};

/* ------------------------------------------------------------------ */
/* Shared small components                                             */
/* ------------------------------------------------------------------ */

function PanelActionRow({
  icon: Icon,
  label,
  onClick,
  disabled,
  detail,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  detail?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        disabled
          ? "cursor-not-allowed opacity-50"
          : "text-foreground hover:bg-accent",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{label}</span>
        {detail && (
          <span className="truncate text-xs text-muted-foreground">
            {detail}
          </span>
        )}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Diff file list for the panel's Diff tab                             */
/* ------------------------------------------------------------------ */

function DiffFileStatusDot({ status }: { status: DiffFile["status"] }) {
  const colors = {
    added: "bg-green-500",
    modified: "bg-blue-500",
    deleted: "bg-red-500",
    renamed: "bg-yellow-500",
  };

  return <span className={cn("h-2 w-2 shrink-0 rounded-full", colors[status])} />;
}

type DiffScope = "all" | "uncommitted";

function isUncommittedFile(file: DiffFile): boolean {
  return file.stagingStatus === "unstaged" || file.stagingStatus === "partial";
}

function DiffFileList({ files }: { files: DiffFile[] }) {
  const { openDiffToFile } = useGitPanel();
  const [scope, setScope] = useState<DiffScope>("all");

  const filteredFiles =
    scope === "all" ? files : files.filter(isUncommittedFile);
  const uncommittedCount = files.filter(isUncommittedFile).length;

  if (files.length === 0) {
    return (
      <div className="px-3 py-6 text-center text-xs text-muted-foreground">
        No changes detected
      </div>
    );
  }

  return (
    <div>
      {/* Scope filter */}
      {uncommittedCount > 0 && uncommittedCount < files.length && (
        <div className="mb-1 flex items-center gap-1 px-1">
          <button
            type="button"
            onClick={() => setScope("all")}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              scope === "all"
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => setScope("uncommitted")}
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
              scope === "uncommitted"
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Uncommitted
          </button>
        </div>
      )}
    <div className="space-y-px">
      {filteredFiles.map((file) => {
        const fileName = file.path.split("/").pop() ?? file.path;
        const dirPath = file.path.slice(0, -fileName.length);

        return (
          <button
            key={file.path}
            type="button"
            onClick={() => openDiffToFile(file.path)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
          >
            <DiffFileStatusDot status={file.status} />
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <span className="min-w-0 truncate text-xs">
                {dirPath && (
                  <span className="text-muted-foreground">{dirPath}</span>
                )}
                <span className="font-medium text-foreground">{fileName}</span>
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
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
          </button>
        );
      })}
    </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inline merge UI (replaces the modal dialog)                         */
/* ------------------------------------------------------------------ */

function InlineMergePanel({
  session,
  onMerged,
  onFixChecks,
}: {
  session: Session;
  onMerged: (result: MergePullRequestResponse) => Promise<void> | void;
  onFixChecks?: (failedRuns: PullRequestCheckRun[]) => Promise<void> | void;
}) {
  const [readiness, setReadiness] = useState<MergeReadinessResponse | null>(
    null,
  );
  const [mergeMethod, setMergeMethod] =
    useState<PullRequestMergeMethod>("squash");
  const [deleteBranch, setDeleteBranch] = useState(true);
  const [isLoadingReadiness, setIsLoadingReadiness] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [forceConfirming, setForceConfirming] = useState(false);

  const readinessRequestIdRef = useRef(0);
  const forceConfirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const hasLoadedRef = useRef(false);

  const loadReadiness = useCallback(async () => {
    const requestId = readinessRequestIdRef.current + 1;
    readinessRequestIdRef.current = requestId;

    setIsLoadingReadiness(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/sessions/${session.id}/merge-readiness`,
      );

      const payload = (await response.json()) as
        | MergeReadinessResponse
        | { error?: string };

      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Failed to load merge readiness",
        );
      }

      if (readinessRequestIdRef.current !== requestId) {
        return;
      }

      const readinessPayload = payload as MergeReadinessResponse;
      setReadiness(readinessPayload);
      setMergeMethod(readinessPayload.defaultMethod);
    } catch (loadError) {
      if (readinessRequestIdRef.current !== requestId) {
        return;
      }

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load merge readiness",
      );
    } finally {
      if (readinessRequestIdRef.current === requestId) {
        setIsLoadingReadiness(false);
      }
    }
  }, [session.id]);

  // Load readiness on mount
  useEffect(() => {
    if (!hasLoadedRef.current) {
      hasLoadedRef.current = true;
      void loadReadiness();
    }
  }, [loadReadiness]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (forceConfirmTimeoutRef.current) {
        clearTimeout(forceConfirmTimeoutRef.current);
      }
    };
  }, []);

  const canMerge = readiness?.canMerge ?? false;
  const pullRequestUrl = readiness?.pr
    ? `https://github.com/${readiness.pr.repo}/pull/${readiness.pr.number}`
    : session.repoOwner && session.repoName && session.prNumber
      ? `https://github.com/${session.repoOwner}/${session.repoName}/pull/${session.prNumber}`
      : null;

  const handleMerge = async (force = false) => {
    if (!readiness?.pr) {
      setError("No pull request found for this session.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/sessions/${session.id}/merge`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          mergeMethod,
          deleteBranch,
          expectedHeadSha: readiness.pr.headSha,
          ...(force ? { force: true } : {}),
        }),
      });

      const payload = (await response.json()) as
        | MergePullRequestResponse
        | { error?: string; reasons?: string[] };

      if (!response.ok) {
        const reasonsText =
          "reasons" in payload && Array.isArray(payload.reasons)
            ? payload.reasons.filter((reason) => typeof reason === "string")
            : [];

        const fallback =
          reasonsText.length > 0
            ? reasonsText.join(". ")
            : "Failed to merge pull request";

        throw new Error(
          "error" in payload && payload.error ? payload.error : fallback,
        );
      }

      const mergeResult = payload as MergePullRequestResponse;
      if (mergeResult.merged !== true) {
        throw new Error("Failed to merge pull request");
      }

      await onMerged(mergeResult);
    } catch (mergeError) {
      setError(
        mergeError instanceof Error
          ? mergeError.message
          : "Failed to merge pull request",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const canForce =
    readiness !== null &&
    !readiness.canMerge &&
    readiness.pr !== null &&
    !isLoadingReadiness;

  const handleForceClick = () => {
    if (forceConfirming) {
      if (forceConfirmTimeoutRef.current) {
        clearTimeout(forceConfirmTimeoutRef.current);
        forceConfirmTimeoutRef.current = null;
      }
      setForceConfirming(false);
      void handleMerge(true);
    } else {
      setForceConfirming(true);
      forceConfirmTimeoutRef.current = setTimeout(() => {
        setForceConfirming(false);
        forceConfirmTimeoutRef.current = null;
      }, 5000);
    }
  };

  const allowedMethods = readiness?.allowedMethods ?? ["squash"];
  const hasMultipleMethods = allowedMethods.length > 1;
  const mergeDisabled =
    isSubmitting || isLoadingReadiness || !readiness || !readiness.pr;

  return (
    <div className="space-y-3">
      {/* Check runs */}
      <CheckRunsList
        checkRuns={readiness?.checkRuns ?? []}
        checks={
          readiness?.checks.requiredTotal
            ? {
                passed: readiness.checks.passed,
                pending: readiness.checks.pending,
                failed: readiness.checks.failed,
              }
            : undefined
        }
        onRefresh={() => {
          void loadReadiness();
        }}
        isRefreshing={isLoadingReadiness}
        isLoading={isLoadingReadiness && !readiness}
        onFixChecks={onFixChecks}
      />

      {/* PR link */}
      {pullRequestUrl && (
        <button
          type="button"
          onClick={() =>
            window.open(pullRequestUrl, "_blank", "noopener,noreferrer")
          }
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
          <span>View PR #{session.prNumber}</span>
        </button>
      )}

      {/* Delete branch toggle */}
      <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 p-2.5">
        <div className="space-y-0.5">
          <p className="text-xs font-medium">Delete source branch</p>
          <p className="text-[10px] text-muted-foreground">
            Deletes the PR branch after merge.
          </p>
        </div>
        <Switch
          checked={deleteBranch}
          onCheckedChange={setDeleteBranch}
          disabled={isSubmitting || isLoadingReadiness}
        />
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-md bg-destructive/10 p-2.5 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Merge action */}
      {canMerge ? (
        <div className="flex w-full">
          <Button
            size="sm"
            onClick={() => void handleMerge()}
            disabled={mergeDisabled}
            className={cn(
              "min-w-0 flex-1",
              hasMultipleMethods && "rounded-r-none",
            )}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Merging...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                {mergeMethodButtonLabels[mergeMethod]}
              </>
            )}
          </Button>
          {hasMultipleMethods && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="default"
                  size="icon"
                  className="h-8 w-8 rounded-l-none border-l border-l-primary-foreground/25"
                  disabled={mergeDisabled}
                  aria-label="Choose merge method"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {allowedMethods.map((method) => (
                  <DropdownMenuItem
                    key={method}
                    className="items-start gap-3 py-2"
                    onSelect={() => setMergeMethod(method)}
                  >
                    <Check
                      className={
                        mergeMethod === method
                          ? "mt-0.5 h-4 w-4"
                          : "mt-0.5 h-4 w-4 opacity-0"
                      }
                    />
                    <div className="flex flex-col">
                      <span className="text-xs font-medium">
                        {mergeMethodLabels[method]}
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        {mergeMethodDescriptions[method]}
                      </span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ) : canForce ? (
        <Button
          size="sm"
          variant="destructive"
          className="w-full"
          onClick={handleForceClick}
          disabled={isSubmitting || isLoadingReadiness || !readiness?.pr}
        >
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Merging...
            </>
          ) : forceConfirming ? (
            <>
              <AlertTriangle className="mr-2 h-4 w-4" />
              Click again to confirm
            </>
          ) : (
            <>
              <AlertTriangle className="mr-2 h-4 w-4" />
              Merge without passing checks
            </>
          )}
        </Button>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main GitPanel component                                             */
/* ------------------------------------------------------------------ */

export function GitPanel(props: GitPanelProps) {
  const { gitPanelOpen, gitPanelTab, setGitPanelTab } = useGitPanel();

  if (!gitPanelOpen) return null;

  const {
    session,
    hasRepo,
    hasExistingPr,
    existingPrUrl,
    canCreatePr,
    isCreatePrBranchReady,
    showCommitAction,
    commitActionLabel,
    hasUncommittedGitChanges,
    canMergeAndArchive,
    supportsRepoCreation,
    supportsDiff,
    hasDiff,
    isAutoCommitting,
    isChatReady,
    prDeploymentUrl,
    isDeploymentStale,
    buildingDeploymentUrl,
    canRunDevServer,
    devServer,
    codeEditor,
    diffFiles,
    diffSummary,
    onCommitClick,
    onCreatePrClick,
    onCreateRepoClick,
    onOpenPreview,
    onOpenPr,
    onOpenBuildingDeployment,
    onMerged,
    onFixChecks,
  } = props;

  // Determine primary action button (compact, sits in the top bar)
  const renderPrimaryAction = () => {
    if (hasRepo && showCommitAction) {
      return (
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={isAutoCommitting || !isChatReady}
          onClick={onCommitClick}
        >
          {isAutoCommitting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <GitCommit className="mr-1.5 h-3.5 w-3.5" />
          )}
          {isAutoCommitting ? "Committing..." : commitActionLabel}
        </Button>
      );
    }

    if (hasRepo && canCreatePr && isCreatePrBranchReady) {
      return (
        <Button size="sm" className="h-7 text-xs" onClick={onCreatePrClick}>
          <GitPullRequest className="mr-1.5 h-3.5 w-3.5" />
          Create PR
        </Button>
      );
    }

    if (!hasRepo && supportsRepoCreation) {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onCreateRepoClick}
        >
          <FolderGit2 className="mr-1.5 h-3.5 w-3.5" />
          Create Repo
        </Button>
      );
    }

    return null;
  };

  const primaryAction = renderPrimaryAction();

  const hasDiffChanges =
    diffSummary &&
    (diffSummary.totalAdditions > 0 || diffSummary.totalDeletions > 0);

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-l border-border bg-background xl:w-80">
      {/* Panel top bar: PR link (left) + action button (right) */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        {/* Left: PR link or repo info */}
        <div className="flex min-w-0 items-center gap-2">
          {hasExistingPr && existingPrUrl ? (
            /* oxlint-disable-next-line nextjs/no-html-link-for-pages */
            <a
              href={existingPrUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <GitPullRequest className="h-3.5 w-3.5" />
              #{session.prNumber}
              <ExternalLink className="h-3 w-3 text-muted-foreground" />
            </a>
          ) : hasRepo && session.branch ? (
            <span className="truncate text-xs font-medium text-muted-foreground font-mono">
              {session.branch}
            </span>
          ) : null}
        </div>

        {/* Right: primary action */}
        <div className="shrink-0">
          {primaryAction}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-0.5 border-b border-border px-3 py-1">
        {(["code", "diff", "checks"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setGitPanelTab(tab)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              gitPanelTab === tab
                ? "bg-secondary text-secondary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "code" ? "Code" : tab === "diff" ? "Diff" : "Checks"}
            {tab === "diff" && hasDiffChanges && (
              <span className="ml-1 text-[10px] text-muted-foreground">
                {diffFiles?.length ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        {gitPanelTab === "code" && (
          <div className="p-2">
            <div className="space-y-1">
              {/* Dev server */}
              {canRunDevServer && (
                <PanelActionRow
                  icon={
                    devServer.state.status === "starting" ||
                    devServer.state.status === "stopping"
                      ? Loader2
                      : ExternalLink
                  }
                  label={devServer.menuLabel}
                  detail={devServer.menuDetail ?? undefined}
                  onClick={() => void devServer.handlePrimaryAction()}
                  disabled={
                    devServer.state.status === "starting" ||
                    devServer.state.status === "stopping"
                  }
                />
              )}
              {canRunDevServer && devServer.showStopAction && (
                <PanelActionRow
                  icon={Square}
                  label={
                    devServer.state.status === "stopping"
                      ? "Stopping Dev Server..."
                      : "Stop Dev Server"
                  }
                  onClick={() => void devServer.handleStopAction()}
                  disabled={devServer.state.status === "stopping"}
                />
              )}

              {/* Code editor */}
              {canRunDevServer && (
                <PanelActionRow
                  icon={
                    codeEditor.state.status === "starting" ||
                    codeEditor.state.status === "stopping"
                      ? Loader2
                      : ExternalLink
                  }
                  label={codeEditor.menuLabel}
                  detail={codeEditor.menuDetail ?? undefined}
                  onClick={() => void codeEditor.handleOpen()}
                  disabled={
                    codeEditor.state.status === "starting" ||
                    codeEditor.state.status === "stopping"
                  }
                />
              )}

              {/* Preview / deployment */}
              {hasExistingPr && prDeploymentUrl && (
                <PanelActionRow
                  icon={ExternalLink}
                  label={isDeploymentStale ? "Deploying…" : "Preview"}
                  onClick={
                    isDeploymentStale && buildingDeploymentUrl
                      ? onOpenBuildingDeployment
                      : onOpenPreview
                  }
                  disabled={isDeploymentStale && !buildingDeploymentUrl}
                />
              )}

              {!canRunDevServer && (
                <div className="px-2 py-6 text-center text-xs text-muted-foreground">
                  Sandbox is not active
                </div>
              )}
            </div>
          </div>
        )}

        {gitPanelTab === "diff" && (
          <div className="p-2">
            {diffFiles && diffFiles.length > 0 ? (
              <>
                {hasDiffChanges && (
                  <div className="mb-2 flex items-center gap-2 px-2 text-xs text-muted-foreground">
                    <span>{diffFiles.length} file{diffFiles.length !== 1 ? "s" : ""} changed</span>
                    <span className="text-green-600 dark:text-green-500">
                      +{diffSummary!.totalAdditions}
                    </span>
                    <span className="text-red-600 dark:text-red-400">
                      -{diffSummary!.totalDeletions}
                    </span>
                  </div>
                )}
                <DiffFileList files={diffFiles} />
              </>
            ) : (
              <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                {hasDiff ? "Loading..." : "No changes detected"}
              </div>
            )}
          </div>
        )}

        {gitPanelTab === "checks" && (
          <div className="p-3">
            {canMergeAndArchive ? (
              <InlineMergePanel
                session={session}
                onMerged={onMerged}
                onFixChecks={onFixChecks}
              />
            ) : hasExistingPr ? (
              <div className="text-center text-xs text-muted-foreground py-6">
                {showCommitAction
                  ? "Commit changes before merging"
                  : "No open PR to merge"}
              </div>
            ) : (
              <div className="text-center text-xs text-muted-foreground py-6">
                Create a PR to see checks
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
