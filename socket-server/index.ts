import dotenv from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

// Load env in a way that works for BOTH:
// - running from repo root (`npm run dev --prefix socket-server`)
// - running from inside `socket-server/` (`cd socket-server && npm run dev`)
//
// IMPORTANT:
// Next.js loads .env.local and env-specific files (e.g. .env.development.local).
// If we only load .env here, JWT_SECRET can differ between Next and this process,
// causing Socket.IO auth to fail with "UNAUTHORIZED"/"Session ID unknown".
//
// We intentionally do not print any secret values.
const NODE_ENV = process.env.NODE_ENV ?? "development";
const roots = [process.cwd(), path.resolve(process.cwd(), "..")];
const envFilenames = [
  `.env.${NODE_ENV}.local`,
  `.env.local`,
  `.env.${NODE_ENV}`,
  `.env`
];

const loaded: string[] = [];
for (const root of roots) {
  for (const name of envFilenames) {
    const p = path.resolve(root, name);
    if (!existsSync(p)) continue;
    dotenv.config({ path: p, override: false });
    loaded.push(p);
  }
}

import { createServer } from "http";
import express, { type Request, type Response } from "express";

// Ensure `globalThis.crypto` exists (used by existing chat logic).
import { webcrypto } from "node:crypto";
if (!(globalThis as unknown as { crypto?: Crypto }).crypto) {
  (globalThis as unknown as { crypto: Crypto }).crypto = webcrypto as unknown as Crypto;
}

/**
 * NOTE:
 * - This file intentionally keeps the existing Socket.IO event logic unchanged.
 * - The only adjustments here are infrastructure-only (bootstrapping + CORS + env wiring).
 * - No Next.js imports are used.
 */

// ---- Existing Socket.IO server implementation (copied from `src/server/socket.ts`) ----
import type { IncomingMessage, Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";

import { getAuthCookieName, verifyAuthToken } from "@/lib/auth";
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

export type TypingEvent = { sessionId: string; userId: string };
export type MessagesReadEvent = { sessionId: string; messageIds: string[] };
export type MessagesReadUpdateEvent = { sessionId: string; readerId: string; messageIds: string[] };

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
  const forwarded = req.headers["x-forwarded-cookie"];
  const forwardedCookie =
    typeof forwarded === "string" ? forwarded : Array.isArray(forwarded) ? forwarded.join(";") : undefined;
  const cookies = parseCookieHeader(req.headers.cookie ?? forwardedCookie);
  return cookies[getAuthCookieName()] ?? null;
}

export function getOnlineUsers() {
  return Array.from(onlineUsers.values()).map((u) => ({
    userId: u.userId,
    email: u.email
  }));
}

function parseFrontendUrls(raw: string | undefined): string[] {
  const defaults = ["http://localhost:3000", "https://shipper-chat-mvp.vercel.app"];
  const extra =
    raw?.split(",").map((s) => s.trim()).filter(Boolean) ??
    [];
  return Array.from(new Set([...defaults, ...extra]));
}

export function attachSocketServer(server: HttpServer) {
  const allowedOrigins = parseFrontendUrls(process.env.FRONTEND_URL);
  // In local dev, the Next.js dev server proxy does not reliably support WebSocket upgrades.
  // To keep the existing frontend client code unchanged, we force Engine.IO to use polling in dev
  // so the client won't attempt the websocket transport.
  const forcePolling = process.env.NODE_ENV !== "production";
  const isDev = process.env.NODE_ENV !== "production";

  const io = new SocketIOServer(server, {
    ...(forcePolling ? { transports: ["polling"] as const, allowUpgrades: false } : {}),
    cors: {
      origin(origin, cb) {
        // In development we may access the Next.js app via a LAN IP (e.g. http://192.168.x.x:3000),
        // which won't match the static localhost default allow-list. To avoid confusing 400s during
        // the Engine.IO handshake, allow all origins in dev. Production remains allow-listed.
        if (isDev) return cb(null, true);
        // Allow non-browser clients (no Origin header).
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error("CORS_NOT_ALLOWED"), false);
      },
      credentials: true
    }
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

    socket.on(
      "typing:start",
      async (payload: { sessionId: string } | string, ack?: (ok: boolean) => void) => {
        try {
          const sessionId = typeof payload === "string" ? payload : (payload?.sessionId ?? "");
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

          socket.to(`session:${sessionId}`).emit("typing:start", { sessionId, userId: user.userId } satisfies TypingEvent);
          ack?.(true);
        } catch {
          ack?.(false);
        }
      }
    );

    socket.on(
      "typing:stop",
      async (payload: { sessionId: string } | string, ack?: (ok: boolean) => void) => {
        try {
          const sessionId = typeof payload === "string" ? payload : (payload?.sessionId ?? "");
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

          socket.to(`session:${sessionId}`).emit("typing:stop", { sessionId, userId: user.userId } satisfies TypingEvent);
          ack?.(true);
        } catch {
          ack?.(false);
        }
      }
    );

    socket.on(
      "messages:read",
      async (payload: MessagesReadEvent, ack?: (ok: boolean) => void) => {
        try {
          const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
          const messageIds = Array.isArray(payload?.messageIds) ? payload.messageIds.filter((id) => typeof id === "string") : [];
          if (!sessionId || messageIds.length === 0) {
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

          // Frontend-only read receipts: verify message IDs belong to this session, but do not persist.
          const existing = await prisma.message.findMany({
            where: { id: { in: messageIds }, sessionId },
            select: { id: true }
          });
          const validIds = existing.map((m) => m.id);
          if (validIds.length === 0) {
            ack?.(false);
            return;
          }

          io.to(`session:${sessionId}`).emit(
            "messages:read:update",
            { sessionId, readerId: user.userId, messageIds: validIds } satisfies MessagesReadUpdateEvent
          );
          ack?.(true);
        } catch {
          ack?.(false);
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

// ---- Minimal standalone server bootstrap ----

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.disable("x-powered-by");

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));

// The frontend currently calls `/api/socket` as a "warmup" to ensure the socket server exists.
// In the standalone server we keep this endpoint, but it does not bootstrap Next.js or any Socket.IO server.
app.get("/api/socket", (_req: Request, res: Response) => res.status(204).end());

// Used by the Next.js `/api/online-users` route to keep the frontend unchanged.
app.get("/api/online-users", (_req: Request, res: Response) => res.json({ onlineUsers: getOnlineUsers() }));

const httpServer = createServer(app);
attachSocketServer(httpServer);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[socket-server] listening on :${PORT}`);
});

