import { connectSandbox } from "@open-harness/sandbox";
import { getSessionById, updateSession } from "@/lib/db/sessions";
import { findOpenPullRequest } from "@/lib/github/client";
import { isSandboxActive } from "@/lib/sandbox/utils";
import { getServerSession } from "@/lib/session/get-server-session";

interface CheckPRRequest {
  sessionId: string;
}

export async function POST(req: Request) {
  const session = await getServerSession();
  if (!session?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: CheckPRRequest;
  try {
    body = (await req.json()) as CheckPRRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sessionId } = body;

  if (!sessionId) {
    return Response.json({ error: "sessionId is required" }, { status: 400 });
  }

  // Verify session ownership
  const sessionRecord = await getSessionById(sessionId);
  if (!sessionRecord) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }
  if (sessionRecord.userId !== session.user.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  // If we already have a PR number, just return it
  if (sessionRecord.prNumber) {
    return Response.json({
      prNumber: sessionRecord.prNumber,
      prStatus: sessionRecord.prStatus ?? "open",
      branch: sessionRecord.branch,
    });
  }

  if (!sessionRecord.cloneUrl) {
    return Response.json({ error: "No repository linked" }, { status: 400 });
  }

  // Resolve the live branch from the sandbox if it's active
  let liveBranch: string | null = null;

  if (isSandboxActive(sessionRecord.sandboxState)) {
    try {
      const sandbox = await connectSandbox(sessionRecord.sandboxState);
      const cwd = sandbox.workingDirectory;

      const branchResult = await sandbox.exec(
        "git symbolic-ref --short HEAD",
        cwd,
        10000,
      );

      if (branchResult.success && branchResult.stdout.trim()) {
        liveBranch = branchResult.stdout.trim();
      }
    } catch (error) {
      console.error(
        "[check-pr] Failed to get live branch from sandbox:",
        error,
      );
    }
  }

  // Use live branch, falling back to DB branch
  const branch = liveBranch ?? sessionRecord.branch;

  if (!branch) {
    return Response.json({ branch: null, prNumber: null });
  }

  // Update session.branch in DB if live branch differs
  const branchChanged = liveBranch && liveBranch !== sessionRecord.branch;
  if (branchChanged) {
    try {
      await updateSession(sessionId, { branch: liveBranch });
    } catch (error) {
      console.error("[check-pr] Failed to update session branch:", error);
    }
  }

  // Check GitHub for an open PR on this branch
  const result = await findOpenPullRequest({
    repoUrl: sessionRecord.cloneUrl,
    branchName: branch,
  });

  if (!result.success || !result.prNumber) {
    return Response.json({
      branch,
      branchChanged: branchChanged ?? false,
      prNumber: null,
    });
  }

  // Found an existing PR - update the DB
  try {
    await updateSession(sessionId, {
      prNumber: result.prNumber,
      prStatus: "open",
    });
  } catch (error) {
    console.error("[check-pr] Failed to update session PR info:", error);
  }

  return Response.json({
    branch,
    branchChanged: branchChanged ?? false,
    prNumber: result.prNumber,
    prStatus: "open",
    prUrl: result.prUrl,
  });
}
