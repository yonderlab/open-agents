"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  type SessionChatListItem,
  useSessionChats,
} from "@/hooks/use-session-chats";
import { useSessions } from "@/hooks/use-sessions";
import type { Session } from "@/lib/db/schema";
import { InboxSidebar } from "@/components/inbox-sidebar";
import { SessionLayoutContext } from "./session-layout-context";

type SessionLayoutShellProps = {
  session: Session;
  initialChatsData?: {
    defaultModelId: string | null;
    chats: SessionChatListItem[];
  };
  children: React.ReactNode;
};

export function SessionLayoutShell({
  session: initialSession,
  initialChatsData,
  children,
}: SessionLayoutShellProps) {
  const router = useRouter();

  const sessionId = initialSession.id;

  // Keep session chats hook alive so chat-level features still work
  useSessionChats(sessionId, { initialData: initialChatsData });

  // Fetch all sessions for the inbox sidebar
  const {
    sessions,
    loading: sessionsLoading,
    refreshSessions,
  } = useSessions({
    enabled: true,
  });

  // Derive lastRepo from the current session for the new-session dialog
  const lastRepo = useMemo(() => {
    if (initialSession.repoOwner && initialSession.repoName) {
      return {
        owner: initialSession.repoOwner,
        repo: initialSession.repoName,
      };
    }
    return null;
  }, [initialSession.repoOwner, initialSession.repoName]);

  // Handle session click from the inbox sidebar
  const handleSessionClick = useCallback(
    (targetSessionId: string) => {
      router.push(`/sessions/${targetSessionId}`);
    },
    [router],
  );

  // Handle renaming a session
  const handleRenameSession = useCallback(
    async (targetSessionId: string, title: string) => {
      await fetch(`/api/sessions/${targetSessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      await refreshSessions();
    },
    [refreshSessions],
  );

  const sidebarContent = (
    <InboxSidebar
      sessions={sessions}
      sessionsLoading={sessionsLoading}
      activeSessionId={sessionId}
      onSessionClick={handleSessionClick}
      onRenameSession={handleRenameSession}
      lastRepo={lastRepo}
    />
  );

  const layoutContext = useMemo(
    () => ({
      session: {
        title: initialSession.title,
        repoName: initialSession.repoName,
        repoOwner: initialSession.repoOwner,
        cloneUrl: initialSession.cloneUrl,
        branch: initialSession.branch,
      },
    }),
    [initialSession],
  );

  return (
    <SessionLayoutContext.Provider value={layoutContext}>
      <SidebarProvider
        className="h-dvh overflow-hidden"
        style={
          {
            "--sidebar-width": "20rem",
          } as React.CSSProperties
        }
      >
        <Sidebar collapsible="offcanvas" className="border-r border-border">
          <SidebarContent className="bg-muted/20">
            {sidebarContent}
          </SidebarContent>
        </Sidebar>
        <SidebarInset className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </SidebarInset>
      </SidebarProvider>
    </SessionLayoutContext.Provider>
  );
}
