export type InboxEventType =
  | "question_asked"
  | "approval_requested"
  | "run_failed"
  | "review_ready"
  | "run_completed_no_output"
  | "running_update";

export type InboxGroup =
  | "action_required"
  | "review_ready"
  | "no_output"
  | "updates";

export type InboxSeverity = "critical" | "high" | "medium" | "low";

export type InboxActionType = "open_session" | "mark_done";

export interface InboxSessionRef {
  sessionId: string;
  chatId: string | null;
  title: string;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
  status: "running" | "completed" | "failed" | "archived";
}

export interface InboxItem {
  id: string;
  dedupeKey: string;
  group: InboxGroup;
  eventType: InboxEventType;
  severity: InboxSeverity;
  createdAt: string;
  updatedAt: string;
  title: string;
  preview: string;
  session: InboxSessionRef;
  badges: {
    hasUnread: boolean;
    hasStreaming: boolean;
    linesAdded: number | null;
    linesRemoved: number | null;
    prStatus: "open" | "merged" | "closed" | null;
  };
  actions: {
    type: InboxActionType;
    label: string;
    primary?: boolean;
  }[];
  links: {
    sessionUrl: string;
  };
}

export interface GetInboxResponse {
  serverTime: string;
  counts: {
    total: number;
    actionRequired: number;
    reviewReady: number;
    noOutput: number;
    updates: number;
    running: number;
  };
  groups: {
    actionRequired: InboxItem[];
    reviewReady: InboxItem[];
    noOutput: InboxItem[];
    updates: InboxItem[];
  };
}

export interface InboxActionRequest {
  itemId: string;
  action: InboxActionType;
  payload?: {
    sessionUrl?: string;
  };
}

export interface InboxActionResponse {
  ok: boolean;
  itemId: string;
  action: InboxActionType;
  redirectUrl?: string;
}
