"use client";

import { Archive, GitMerge, Pencil, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NewSessionDialog } from "@/components/new-session-dialog";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import type { SessionWithUnread } from "@/hooks/use-sessions";

type InboxSidebarProps = {
  sessions: SessionWithUnread[];
  sessionsLoading: boolean;
  activeSessionId: string;
  onSessionClick: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  lastRepo: { owner: string; repo: string } | null;
};

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function DiffStats({
  added,
  removed,
}: {
  added: number | null;
  removed: number | null;
}) {
  if (added === null && removed === null) return null;

  return (
    <span className="flex items-center gap-0.5 font-mono text-[10px]">
      {added !== null ? <span className="text-green-500">+{added}</span> : null}
      {removed !== null ? (
        <span className="text-red-400">-{removed}</span>
      ) : null}
    </span>
  );
}

function PrBadge({
  prNumber,
  status,
}: {
  prNumber: number | null;
  status: "open" | "merged" | "closed" | null;
}) {
  if (!prNumber) return null;

  if (status === "merged") {
    return (
      <span className="flex items-center gap-0.5 text-[10px] text-purple-400">
        <GitMerge className="h-2.5 w-2.5" />
        <span>#{prNumber}</span>
      </span>
    );
  }

  return <span className="text-[10px] text-muted-foreground">#{prNumber}</span>;
}

export function InboxSidebar({
  sessions,
  sessionsLoading,
  activeSessionId,
  onSessionClick,
  onRenameSession,
  lastRepo,
}: InboxSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const [showArchived, setShowArchived] = useState(false);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status !== "archived"),
    [sessions],
  );
  const archivedSessions = useMemo(
    () => sessions.filter((s) => s.status === "archived"),
    [sessions],
  );
  const displayedSessions = showArchived ? archivedSessions : activeSessions;

  const handleSessionClick = useCallback(
    (sessionId: string) => {
      if (isMobile) setOpenMobile(false);
      onSessionClick(sessionId);
    },
    [isMobile, setOpenMobile, onSessionClick],
  );

  const handleRenameSubmit = useCallback(
    async (sessionId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) {
        setEditingSessionId(null);
        return;
      }
      try {
        await onRenameSession(sessionId, trimmed);
      } catch (err) {
        console.error("Failed to rename session:", err);
      } finally {
        setEditingSessionId(null);
      }
    },
    [onRenameSession],
  );

  return (
    <>
      {/* Header */}
      <div className="border-b border-border p-3">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Inbox</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => setNewSessionOpen(true)}
            className="h-7 w-7"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {/* Filter toggle */}
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setShowArchived(false)}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              !showArchived
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Active
            {activeSessions.length > 0 && (
              <span className="ml-1.5 text-muted-foreground">
                {activeSessions.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setShowArchived(true)}
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              showArchived
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Archive className="h-3 w-3" />
            Archive
            {archivedSessions.length > 0 && (
              <span className="ml-1 text-muted-foreground">
                {archivedSessions.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sessionsLoading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5 rounded-md px-3 py-2.5">
                <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : displayedSessions.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {showArchived ? "No archived sessions" : "No sessions yet"}
          </div>
        ) : (
          <div className="space-y-px p-1.5">
            {displayedSessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isWorking = session.hasStreaming;
              const isUnread = session.hasUnread && !isActive;
              const isEditing = editingSessionId === session.id;

              return (
                <div
                  key={session.id}
                  className={`group relative flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    isActive ? "bg-secondary" : "hover:bg-muted/50"
                  }`}
                >
                  {/* Status dot */}
                  <div className="flex h-5 w-3 shrink-0 items-center justify-center">
                    {isWorking ? (
                      <span className="h-2 w-2 rounded-full bg-foreground/70 animate-pulse" />
                    ) : isUnread ? (
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    ) : null}
                  </div>

                  {/* Content */}
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            void handleRenameSubmit(session.id, editingTitle);
                          } else if (e.key === "Escape") {
                            setEditingSessionId(null);
                          }
                        }}
                        onBlur={() => {
                          void handleRenameSubmit(session.id, editingTitle);
                        }}
                        className="h-5 w-full rounded bg-transparent text-sm font-medium text-foreground focus:outline-none"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSessionClick(session.id)}
                        className="block w-full text-left"
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <p
                            className={`truncate text-sm ${
                              isUnread || isWorking
                                ? "font-semibold text-foreground"
                                : "font-medium text-foreground"
                            }`}
                          >
                            {session.title}
                          </p>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {formatRelativeTime(new Date(session.createdAt))}
                          </span>
                        </div>

                        {/* Preview line: repo + branch + stats */}
                        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                          {session.repoName && (
                            <span className="truncate">
                              {session.repoName}
                              {session.branch && (
                                <span className="text-muted-foreground/50">
                                  /{session.branch}
                                </span>
                              )}
                            </span>
                          )}
                          {!session.repoName && isWorking && (
                            <span className="text-muted-foreground/60">
                              Working...
                            </span>
                          )}
                          <span className="ml-auto flex shrink-0 items-center gap-1.5">
                            <PrBadge
                              prNumber={session.prNumber}
                              status={session.prStatus}
                            />
                            <DiffStats
                              added={session.linesAdded}
                              removed={session.linesRemoved}
                            />
                          </span>
                        </div>
                      </button>
                    )}
                  </div>

                  {/* Rename button — visible on hover */}
                  {!isEditing && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingSessionId(session.id);
                        setEditingTitle(session.title);
                      }}
                      className="absolute right-2 top-2.5 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-background/60 hover:text-foreground group-hover:opacity-100"
                      aria-label={`Rename ${session.title}`}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New session modal */}
      <NewSessionDialog
        open={newSessionOpen}
        onOpenChange={setNewSessionOpen}
        lastRepo={lastRepo}
      />
    </>
  );
}
