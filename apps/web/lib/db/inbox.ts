import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "./client";
import { chatMessages, chats } from "./schema";
import {
  type SessionWithUnread,
  getSessionsWithUnreadByUserId,
} from "./sessions";

export interface SessionInboxContext {
  session: SessionWithUnread;
  latestChatId: string | null;
  latestAssistantParts: unknown[] | null;
  latestAssistantMessageAt: Date | null;
}

function toPartsArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export async function getSessionInboxContexts(
  userId: string,
): Promise<SessionInboxContext[]> {
  const userSessions = await getSessionsWithUnreadByUserId(userId);

  if (userSessions.length === 0) {
    return [];
  }

  const sessionIds = userSessions.map((session) => session.id);

  const chatRows = await db
    .select({
      id: chats.id,
      sessionId: chats.sessionId,
      createdAt: chats.createdAt,
    })
    .from(chats)
    .where(inArray(chats.sessionId, sessionIds))
    .orderBy(desc(chats.createdAt));

  const latestChatBySession = new Map<
    string,
    { id: string; createdAt: Date | null }
  >();

  for (const chatRow of chatRows) {
    if (!latestChatBySession.has(chatRow.sessionId)) {
      latestChatBySession.set(chatRow.sessionId, {
        id: chatRow.id,
        createdAt: chatRow.createdAt,
      });
    }
  }

  const latestChatIds = Array.from(latestChatBySession.values()).map(
    (chatRow) => chatRow.id,
  );

  const latestAssistantByChatId = new Map<
    string,
    { parts: unknown[] | null; createdAt: Date | null }
  >();

  if (latestChatIds.length > 0) {
    const assistantMessageRows = await db
      .select({
        chatId: chatMessages.chatId,
        createdAt: chatMessages.createdAt,
        parts: chatMessages.parts,
      })
      .from(chatMessages)
      .where(
        and(
          inArray(chatMessages.chatId, latestChatIds),
          eq(chatMessages.role, "assistant"),
        ),
      )
      .orderBy(desc(chatMessages.createdAt));

    for (const messageRow of assistantMessageRows) {
      if (!latestAssistantByChatId.has(messageRow.chatId)) {
        latestAssistantByChatId.set(messageRow.chatId, {
          parts: toPartsArray(messageRow.parts),
          createdAt: messageRow.createdAt,
        });
      }
    }
  }

  return userSessions.map((session) => {
    const latestChat = latestChatBySession.get(session.id);
    const latestAssistant = latestChat
      ? latestAssistantByChatId.get(latestChat.id)
      : undefined;

    return {
      session,
      latestChatId: latestChat?.id ?? null,
      latestAssistantParts: latestAssistant?.parts ?? null,
      latestAssistantMessageAt: latestAssistant?.createdAt ?? null,
    };
  });
}
