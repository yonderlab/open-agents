import type {
  InboxActionRequest,
  InboxActionResponse,
} from "@/lib/inbox/types";
import { getServerSession } from "@/lib/session/get-server-session";

function isOpenHarnessSessionPath(path: string): boolean {
  return path.startsWith("/sessions/");
}

function isActionRequest(value: unknown): value is InboxActionRequest {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const maybeRequest = value as {
    itemId?: unknown;
    action?: unknown;
    payload?: unknown;
  };

  if (typeof maybeRequest.itemId !== "string") {
    return false;
  }

  if (
    maybeRequest.action !== "open_session" &&
    maybeRequest.action !== "mark_done"
  ) {
    return false;
  }

  if (maybeRequest.payload !== undefined) {
    if (
      typeof maybeRequest.payload !== "object" ||
      maybeRequest.payload === null
    ) {
      return false;
    }

    const payload = maybeRequest.payload as { sessionUrl?: unknown };
    if (
      payload.sessionUrl !== undefined &&
      typeof payload.sessionUrl !== "string"
    ) {
      return false;
    }
  }

  return true;
}

export async function POST(req: Request) {
  const authSession = await getServerSession();
  if (!authSession?.user) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isActionRequest(body)) {
    return Response.json({ error: "Invalid action payload" }, { status: 400 });
  }

  if (body.action === "open_session") {
    const redirectUrl = body.payload?.sessionUrl;
    if (!redirectUrl || !isOpenHarnessSessionPath(redirectUrl)) {
      return Response.json({ error: "Invalid session URL" }, { status: 400 });
    }

    const response: InboxActionResponse = {
      ok: true,
      itemId: body.itemId,
      action: body.action,
      redirectUrl,
    };

    return Response.json(response);
  }

  const response: InboxActionResponse = {
    ok: true,
    itemId: body.itemId,
    action: body.action,
  };

  return Response.json(response);
}
