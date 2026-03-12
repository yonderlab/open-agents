"use client";

import { useEffect, useRef, useState } from "react";
import type { TaskPendingToolCall } from "@open-harness/agent";
import { formatTokens, toRelativePath } from "@open-harness/shared";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ToolRendererProps } from "@/app/lib/render-tool";
import { DEFAULT_WORKING_DIRECTORY } from "@/lib/sandbox/config";
import { ToolLayout } from "../tool-layout";

function getToolSummary(toolCall: TaskPendingToolCall): string {
  const input = toolCall.input as Record<string, unknown> | undefined;
  switch (toolCall.name) {
    case "read":
    case "write":
    case "edit": {
      const fp = input?.filePath ?? "";
      return fp ? toRelativePath(String(fp), DEFAULT_WORKING_DIRECTORY) : "";
    }
    case "grep":
    case "glob":
      return input?.pattern ? `"${input.pattern}"` : "";
    case "bash": {
      const cmd = input?.command ? String(input.command) : "";
      return cmd.length > 60 ? cmd.slice(0, 60) + "…" : cmd;
    }
    default:
      return "";
  }
}

function countToolCalls(messages: unknown): number {
  if (!Array.isArray(messages)) return 0;
  return messages.filter(
    (message) =>
      typeof message === "object" &&
      message !== null &&
      (message as { role?: string }).role === "tool",
  ).length;
}

function formatTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function useTaskTiming(isRunning: boolean, startedAtMs?: number) {
  const fallbackStartRef = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    if (startedAtMs == null && !fallbackStartRef.current) {
      fallbackStartRef.current = Date.now();
    }

    setNow(Date.now());
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [isRunning, startedAtMs]);

  const effectiveStart = startedAtMs ?? fallbackStartRef.current;
  if (!isRunning || effectiveStart == null) {
    return 0;
  }

  return Math.max(0, Math.floor((now - effectiveStart) / 1000));
}

function getSubagentSummary(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;

  const lastAssistantMessage = messages.findLast(
    (m) =>
      typeof m === "object" &&
      m !== null &&
      (m as { role?: string }).role === "assistant",
  );

  if (!lastAssistantMessage) return null;

  const content = (lastAssistantMessage as { content?: unknown }).content;

  if (typeof content === "string") {
    return content.trim() || null;
  }

  if (Array.isArray(content)) {
    const lastTextPart = content.findLast(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        (p as { type?: string }).type === "text",
    );
    if (lastTextPart) {
      const text = (lastTextPart as { text?: string }).text;
      return text?.trim() || null;
    }
  }

  return null;
}

function getPendingToolLabel(toolCall: TaskPendingToolCall): string {
  const displayName =
    toolCall.name.charAt(0).toUpperCase() + toolCall.name.slice(1);
  const summary = getToolSummary(toolCall);
  return summary ? `${displayName} ${summary}` : displayName;
}

export function TaskRenderer({
  part,
  state,
  isStreaming = false,
  onApprove,
  onDeny,
}: ToolRendererProps<"tool-task"> & { isStreaming?: boolean }) {
  const input = part.input;
  const desc = input?.task ?? "Spawning subagent";
  const fullPrompt = input?.instructions;
  const subagentType = input?.subagentType;
  const taskApprovalRequested = part.state === "approval-requested";
  const taskDenied = part.state === "output-denied";

  const hasOutput = part.state === "output-available";
  const isPreliminary = hasOutput && part.preliminary === true;
  const isComplete = hasOutput && !isPreliminary;
  const output = hasOutput ? part.output : undefined;

  const pendingToolCall: TaskPendingToolCall | null = output?.pending ?? null;
  const toolCount =
    output?.toolCallCount ?? (isComplete ? countToolCalls(output?.final) : 0);
  const tokenCount = output?.usage?.inputTokens ?? null;

  // Detect running/interrupted properly for task tools.
  // extractRenderState only knows about input-streaming/input-available,
  // but tasks also run in output-available + preliminary state.
  const isTaskStreaming = hasOutput && isPreliminary;
  const isRunningState =
    part.state === "input-streaming" ||
    part.state === "input-available" ||
    isTaskStreaming;
  const isInterrupted = isRunningState && !isStreaming;
  const isActuallyRunning = isRunningState && isStreaming;

  const startedAt =
    typeof output?.startedAt === "number" ? output.startedAt : undefined;
  const elapsedSeconds = useTaskTiming(isActuallyRunning, startedAt);

  const subagentLabel =
    subagentType === "explorer"
      ? "Explorer"
      : subagentType === "executor"
        ? "Executor"
        : subagentType === "general"
          ? "General"
          : "Task";

  const indicator = isInterrupted ? (
    <span className="inline-block h-2 w-2 rounded-full border border-yellow-500" />
  ) : isActuallyRunning ? (
    <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
  ) : (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        taskDenied
          ? "bg-red-500"
          : taskApprovalRequested
            ? "bg-yellow-500"
            : isComplete
              ? "bg-green-500"
              : "bg-yellow-500",
      )}
    />
  );

  // Build accumulating meta for the right side
  const metaParts: string[] = [];

  if (toolCount > 0) {
    metaParts.push(`${toolCount} tool${toolCount === 1 ? "" : "s"}`);
  }

  if (isActuallyRunning) {
    if (elapsedSeconds > 0) {
      metaParts.push(formatTime(elapsedSeconds));
    }
  } else if (isComplete && tokenCount !== null) {
    metaParts.push(`${formatTokens(tokenCount)} tokens`);
  }

  const meta =
    metaParts.length > 0 ? (
      <span className="inline-flex items-center gap-1">
        {metaParts.join(" · ")}
      </span>
    ) : undefined;

  // Extract subagent's final summary when complete
  const subagentSummary = isComplete ? getSubagentSummary(output?.final) : null;

  // Current tool activity label (one-liner)
  const currentToolLabel = pendingToolCall
    ? getPendingToolLabel(pendingToolCall)
    : null;

  const hasExpandableContent =
    Boolean(fullPrompt) ||
    subagentSummary !== null ||
    currentToolLabel !== null;

  // Override state for ToolLayout so it reflects task-specific interrupted/running
  const layoutState = {
    ...state,
    running: isActuallyRunning,
    interrupted: isInterrupted,
  };

  const expandedContent = hasExpandableContent ? (
    <div className="space-y-3">
      {/* Live tool activity when running */}
      {currentToolLabel && (
        <div className="text-[13px] text-muted-foreground">
          {currentToolLabel}
        </div>
      )}

      {/* Task prompt */}
      {fullPrompt && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Task prompt
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs text-foreground">
            {fullPrompt}
          </pre>
        </div>
      )}

      {/* Subagent summary when complete */}
      {subagentSummary && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">
            Summary
          </div>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-xs text-foreground">
            {subagentSummary}
          </pre>
        </div>
      )}
    </div>
  ) : undefined;

  const approvalWarning =
    taskApprovalRequested && subagentType === "executor" ? (
      <div className="mt-2 pl-5 text-sm text-yellow-500">
        This executor has full write access and can create, modify, and delete
        files.
      </div>
    ) : undefined;

  return (
    <ToolLayout
      name={subagentLabel}
      summary={desc}
      meta={meta}
      state={layoutState}
      indicator={indicator}
      nameClassName={taskDenied ? "text-red-500" : undefined}
      expandedContent={expandedContent}
      onApprove={onApprove}
      onDeny={onDeny}
    >
      {approvalWarning}
    </ToolLayout>
  );
}
