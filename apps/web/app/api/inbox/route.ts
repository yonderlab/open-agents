import { getSessionInboxContexts } from "@/lib/db/inbox";
import type {
  GetInboxResponse,
  InboxEventType,
  InboxGroup,
  InboxItem,
  InboxSeverity,
} from "@/lib/inbox/types";
import { getServerSession } from "@/lib/session/get-server-session";

interface ToolSignals {
  hasPendingQuestion: boolean;
  hasPendingApproval: boolean;
  hasToolError: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toLowerText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function getToolSignals(parts: unknown[] | null): ToolSignals {
  if (!parts) {
    return {
      hasPendingQuestion: false,
      hasPendingApproval: false,
      hasToolError: false,
    };
  }

  let hasPendingQuestion = false;
  let hasPendingApproval = false;
  let hasToolError = false;

  for (const part of parts) {
    if (!isRecord(part)) continue;

    const type = part.type;
    const state = part.state;

    if (typeof type !== "string" || typeof state !== "string") {
      continue;
    }

    if (type === "tool-ask_user_question" && state === "input-available") {
      hasPendingQuestion = true;
    }

    if (type.startsWith("tool-") && state === "approval-requested") {
      hasPendingApproval = true;
    }

    if (type.startsWith("tool-") && state === "output-error") {
      hasToolError = true;
    }
  }

  return {
    hasPendingQuestion,
    hasPendingApproval,
    hasToolError,
  };
}

function getEventGroup(eventType: InboxEventType): InboxGroup {
  switch (eventType) {
    case "question_asked":
    case "approval_requested":
    case "run_failed":
      return "action_required";
    case "review_ready":
      return "review_ready";
    case "run_completed_no_output":
      return "no_output";
    case "running_update":
      return "updates";
  }
}

function getEventSeverity(eventType: InboxEventType): InboxSeverity {
  switch (eventType) {
    case "question_asked":
    case "approval_requested":
      return "critical";
    case "run_failed":
      return "high";
    case "run_completed_no_output":
      return "medium";
    case "review_ready":
      return "medium";
    case "running_update":
      return "low";
  }
}

function deriveEventType(args: {
  hasPendingQuestion: boolean;
  hasPendingApproval: boolean;
  hasFailure: boolean;
  hasUnread: boolean;
  hasStreaming: boolean;
  hasMeaningfulOutput: boolean;
}): InboxEventType | null {
  if (args.hasPendingQuestion) return "question_asked";
  if (args.hasPendingApproval) return "approval_requested";
  if (args.hasFailure) return "run_failed";

  const completedWithUnread = args.hasUnread && !args.hasStreaming;

  if (completedWithUnread && !args.hasMeaningfulOutput) {
    return "run_completed_no_output";
  }

  if (completedWithUnread && args.hasMeaningfulOutput) {
    return "review_ready";
  }

  if (args.hasStreaming) {
    return "running_update";
  }

  return null;
}

function getEventCopy(eventType: InboxEventType): {
  title: string;
  preview: string;
  primaryActionLabel: string;
} {
  switch (eventType) {
    case "question_asked":
      return {
        title: "Question from agent",
        preview: "This run is waiting for your answer.",
        primaryActionLabel: "Answer",
      };
    case "approval_requested":
      return {
        title: "Approval required",
        preview: "A tool call is blocked on your approval.",
        primaryActionLabel: "Review",
      };
    case "run_failed":
      return {
        title: "Run blocked",
        preview: "The run hit an error and needs guidance.",
        primaryActionLabel: "Investigate",
      };
    case "review_ready":
      return {
        title: "Review ready",
        preview: "Work finished and has changes to review.",
        primaryActionLabel: "Review",
      };
    case "run_completed_no_output":
      return {
        title: "Run completed with no output",
        preview: "No meaningful code changes were detected.",
        primaryActionLabel: "Investigate",
      };
    case "running_update":
      return {
        title: "Run in progress",
        preview: "The agent is still working.",
        primaryActionLabel: "Open",
      };
  }
}

function includesQuery(args: {
  query: string;
  title: string;
  repoOwner: string | null;
  repoName: string | null;
  branch: string | null;
}): boolean {
  if (!args.query) return true;

  const haystack = [args.title, args.repoOwner, args.repoName, args.branch]
    .map((value) => toLowerText(value))
    .join(" ");

  return haystack.includes(args.query);
}

function sortItemsByUpdatedAt(items: InboxItem[]): InboxItem[] {
  return items.toSorted(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export async function GET(req: Request) {
  const authSession = await getServerSession();
  if (!authSession?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const url = new URL(req.url);
  const query = toLowerText(url.searchParams.get("q")).trim();
  const includeUpdates = url.searchParams.get("includeUpdates") === "true";

  const sessionContexts = await getSessionInboxContexts(authSession.user.id);

  const groupedItems: Record<InboxGroup, InboxItem[]> = {
    action_required: [],
    review_ready: [],
    no_output: [],
    updates: [],
  };

  for (const context of sessionContexts) {
    const {
      session,
      latestChatId,
      latestAssistantMessageAt,
      latestAssistantParts,
    } = context;

    if (session.status === "archived") {
      continue;
    }

    if (
      !includesQuery({
        query,
        title: session.title,
        repoOwner: session.repoOwner,
        repoName: session.repoName,
        branch: session.branch,
      })
    ) {
      continue;
    }

    const toolSignals = getToolSignals(latestAssistantParts);

    const linesAdded = session.linesAdded ?? 0;
    const linesRemoved = session.linesRemoved ?? 0;
    const hasMeaningfulOutput =
      linesAdded > 0 ||
      linesRemoved > 0 ||
      session.prNumber !== null ||
      session.prStatus !== null;

    const hasFailure =
      session.status === "failed" ||
      session.lifecycleState === "failed" ||
      Boolean(session.lifecycleError) ||
      toolSignals.hasToolError;

    const eventType = deriveEventType({
      hasPendingQuestion: toolSignals.hasPendingQuestion,
      hasPendingApproval: toolSignals.hasPendingApproval,
      hasFailure,
      hasUnread: session.hasUnread,
      hasStreaming: session.hasStreaming,
      hasMeaningfulOutput,
    });

    if (!eventType) {
      continue;
    }

    if (eventType === "running_update" && !includeUpdates) {
      continue;
    }

    const copy = getEventCopy(eventType);
    const group = getEventGroup(eventType);
    const timestamp =
      latestAssistantMessageAt ?? session.lastActivityAt ?? session.updatedAt;
    const sessionUrl = latestChatId
      ? `/sessions/${session.id}/chats/${latestChatId}`
      : `/sessions/${session.id}`;

    groupedItems[group].push({
      id: `${session.id}:${eventType}`,
      dedupeKey: `${session.id}:${eventType}`,
      group,
      eventType,
      severity: getEventSeverity(eventType),
      createdAt: timestamp.toISOString(),
      updatedAt: timestamp.toISOString(),
      title: copy.title,
      preview: copy.preview,
      session: {
        sessionId: session.id,
        chatId: latestChatId,
        title: session.title,
        repoOwner: session.repoOwner,
        repoName: session.repoName,
        branch: session.branch,
        status: session.status,
      },
      badges: {
        hasUnread: session.hasUnread,
        hasStreaming: session.hasStreaming,
        linesAdded: session.linesAdded,
        linesRemoved: session.linesRemoved,
        prStatus: session.prStatus,
      },
      actions: [
        {
          type: "open_session",
          label: copy.primaryActionLabel,
          primary: true,
        },
        ...(eventType === "review_ready" ||
        eventType === "run_completed_no_output"
          ? [
              {
                type: "mark_done" as const,
                label: "Mark done",
              },
            ]
          : []),
      ],
      links: {
        sessionUrl,
      },
    });
  }

  const response: GetInboxResponse = {
    serverTime: new Date().toISOString(),
    counts: {
      total:
        groupedItems.action_required.length +
        groupedItems.review_ready.length +
        groupedItems.no_output.length +
        groupedItems.updates.length,
      actionRequired: groupedItems.action_required.length,
      reviewReady: groupedItems.review_ready.length,
      noOutput: groupedItems.no_output.length,
      updates: groupedItems.updates.length,
      running: sessionContexts.filter((context) => context.session.hasStreaming)
        .length,
    },
    groups: {
      actionRequired: sortItemsByUpdatedAt(groupedItems.action_required),
      reviewReady: sortItemsByUpdatedAt(groupedItems.review_ready),
      noOutput: sortItemsByUpdatedAt(groupedItems.no_output),
      updates: sortItemsByUpdatedAt(groupedItems.updates),
    },
  };

  return Response.json(response);
}
