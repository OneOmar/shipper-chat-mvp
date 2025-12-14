import type { IncomingMessage, Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";

import { AUTH_COOKIE_NAME, verifyAuthToken } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getOrCreateAiUser } from "@/lib/ai-user";
import { streamAssistantReply } from "@/lib/ai";

type AuthedSocketData = {
  userId: string;
  email: string;
};

export type UserOnlineEvent = { userId: string; email: string };
export type UserOfflineEvent = { userId: string };

export type ReceiveMessageEvent = {
  id: string;
  content: string;
  role: "user" | "assistant";
  senderId: string;
  sessionId: string;
  createdAt: string;
  sender: { id: string; name: string | null; email: string; image: string | null };
};

export type AiMessageStartEvent = { tempId: string; sessionId: string; sender: ReceiveMessageEvent["sender"] };
export type AiMessageDeltaEvent = { tempId: string; sessionId: string; delta: string; content: string };
export type AiMessageDoneEvent = { tempId: string; sessionId: string; message: ReceiveMessageEvent };

type OnlineUser = {
  userId: string;
  email: string;
  socketIds: Set<string>;
};

const onlineUsers = new Map<string, OnlineUser>();

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawKey, ...rawValParts] = part.split("=");
    const key = rawKey?.trim();
    if (!key) continue;
    const rawVal = rawValParts.join("=").trim();
    if (!rawVal) continue;
    out[key] = decodeURIComponent(rawVal);
  }
  return out;
}

function getTokenFromRequest(req: IncomingMessage) {
  const cookies = parseCookieHeader(req.headers.cookie);
  return cookies[AUTH_COOKIE_NAME] ?? null;
}

export function getOnlineUsers() {
  return Array.from(onlineUsers.values()).map((u) => ({
    userId: u.userId,
    email: u.email
  }));
}

export function attachSocketServer(server: HttpServer) {
  const io = new SocketIOServer(server, {
    cors: { origin: true, credentials: true }
  });

  io.use((socket, next) => {
    const token = getTokenFromRequest(socket.request);
    if (!token) return next(new Error("UNAUTHORIZED"));
    const payload = verifyAuthToken(token);
    if (!payload) return next(new Error("UNAUTHORIZED"));
    socket.data.user = { userId: payload.sub, email: payload.email } satisfies AuthedSocketData;
    return next();
  });

  io.on("connection", (socket) => {
    const user = socket.data.user as AuthedSocketData | undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    socket.on("join_session", async (sessionId: string, ack?: (ok: boolean) => void) => {
      try {
        if (!sessionId || typeof sessionId !== "string") {
          ack?.(false);
          return;
        }

        const participant = await prisma.participant.findUnique({
          where: { userId_sessionId: { userId: user.userId, sessionId } }
        });

        if (!participant) {
          ack?.(false);
          return;
        }

        await socket.join(`session:${sessionId}`);
        ack?.(true);
      } catch {
        ack?.(false);
      }
    });

    socket.on(
      "send_message",
      async (
        payload: { sessionId: string; content: string },
        ack?: (msg: ReceiveMessageEvent | { error: string }) => void
      ) => {
        try {
          const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
          const content = typeof payload?.content === "string" ? payload.content.trim() : "";
          if (!sessionId || !content) {
            ack?.({ error: "Invalid payload" });
            return;
          }

          const participant = await prisma.participant.findUnique({
            where: { userId_sessionId: { userId: user.userId, sessionId } }
          });
          if (!participant) {
            ack?.({ error: "Unauthorized" });
            return;
          }

          const created = await prisma.message.create({
            data: {
              sessionId,
              senderId: user.userId,
              role: "user",
              content
            },
            include: {
              sender: { select: { id: true, name: true, email: true, image: true } }
            }
          });

          const event: ReceiveMessageEvent = {
            id: created.id,
            content: created.content,
            role: created.role,
            senderId: created.senderId,
            sessionId: created.sessionId,
            createdAt: created.createdAt.toISOString(),
            sender: created.sender
          };

          io.to(`session:${sessionId}`).emit("receive_message", event);
          ack?.(event);

          // If this is an AI session, trigger assistant response (stream if possible).
          const session = await prisma.chatSession.findUnique({
            where: { id: sessionId },
            select: { type: true }
          });

          if (session?.type === "ai") {
            const aiUser = await getOrCreateAiUser();

            // Build context from recent messages.
            const history = await prisma.message.findMany({
              where: { sessionId },
              orderBy: { createdAt: "asc" },
              take: 30,
              select: { role: true, content: true }
            });

            const tempId = crypto.randomUUID();
            io.to(`session:${sessionId}`).emit("ai_message_start", {
              tempId,
              sessionId,
              sender: { id: aiUser.id, name: aiUser.name, email: aiUser.email, image: aiUser.image }
            } satisfies AiMessageStartEvent);

            let finalText = "";
            try {
              finalText = await streamAssistantReply(history, (delta, full) => {
                io.to(`session:${sessionId}`).emit("ai_message_delta", {
                  tempId,
                  sessionId,
                  delta,
                  content: full
                } satisfies AiMessageDeltaEvent);
              });
            } catch {
              finalText = "";
            }

            const assistantContent = finalText.trim() || "Sorry — I couldn't generate a response.";
            const aiMsg = await prisma.message.create({
              data: {
                sessionId,
                senderId: aiUser.id,
                role: "assistant",
                content: assistantContent
              },
              include: { sender: { select: { id: true, name: true, email: true, image: true } } }
            });

            const finalEvent: ReceiveMessageEvent = {
              id: aiMsg.id,
              content: aiMsg.content,
              role: aiMsg.role,
              senderId: aiMsg.senderId,
              sessionId: aiMsg.sessionId,
              createdAt: aiMsg.createdAt.toISOString(),
              sender: aiMsg.sender
            };

            io.to(`session:${sessionId}`).emit("ai_message_done", {
              tempId,
              sessionId,
              message: finalEvent
            } satisfies AiMessageDoneEvent);

            io.to(`session:${sessionId}`).emit("receive_message", finalEvent);
          }
        } catch {
          ack?.({ error: "Failed to send message" });
        }
      }
    );

    const existing = onlineUsers.get(user.userId);
    const entry: OnlineUser =
      existing ?? { userId: user.userId, email: user.email, socketIds: new Set<string>() };

    const wasOffline = entry.socketIds.size === 0;
    entry.socketIds.add(socket.id);
    onlineUsers.set(user.userId, entry);

    if (wasOffline) {
      io.emit("user_online", { userId: user.userId, email: user.email } satisfies UserOnlineEvent);
    }

    socket.on("disconnect", () => {
      const current = onlineUsers.get(user.userId);
      if (!current) return;
      current.socketIds.delete(socket.id);
      if (current.socketIds.size === 0) {
        onlineUsers.delete(user.userId);
        io.emit("user_offline", { userId: user.userId } satisfies UserOfflineEvent);
      } else {
        onlineUsers.set(user.userId, current);
      }
    });
  });

  return io;
}


