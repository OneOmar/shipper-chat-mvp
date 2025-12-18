import dotenv from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";

// Load env in a way that works for BOTH:
// - running from repo root (`npm run dev --prefix backend`)
// - running from inside `backend/` (`cd backend && npm run dev`)
//
// IMPORTANT:
// Next.js loads .env.local and env-specific files (e.g. .env.development.local).
// If we only load .env here, JWT_SECRET can differ between Next and this process,
// causing Socket.IO auth to fail with "UNAUTHORIZED"/"Session ID unknown".
//
// We intentionally do not print any secret values.
const NODE_ENV = process.env.NODE_ENV ?? "development";
const roots = Array.from(
  new Set([
    process.cwd(),
    path.resolve(process.cwd(), ".."),
    path.resolve(process.cwd(), "backend"),
    path.resolve(process.cwd(), "..", "backend")
  ])
);
const envFilenames = [
  `.env.${NODE_ENV}.local`,
  `.env.local`,
  `.env.${NODE_ENV}`,
  `.env`
];

for (const root of roots) {
  for (const name of envFilenames) {
    const p = path.resolve(root, name);
    if (!existsSync(p)) continue;
    dotenv.config({ path: p, override: false });
  }
}

import { createServer } from "http";
import express, { type Request, type Response } from "express";
import bcrypt from "bcrypt";

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

import {
  authCookieOptions,
  getAuthCookieName,
  signAuthToken,
  type AuthJwtPayload,
  verifyAuthToken
} from "@/lib/auth";
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
  reactions?: Array<{ emoji: string; count: number }>;
};

export type AiMessageStartEvent = { tempId: string; sessionId: string; sender: ReceiveMessageEvent["sender"] };
export type AiMessageDeltaEvent = { tempId: string; sessionId: string; delta: string; content: string };
export type AiMessageDoneEvent = { tempId: string; sessionId: string; message: ReceiveMessageEvent };

export type TypingEvent = { sessionId: string; userId: string };
export type MessagesReadEvent = { sessionId: string; messageIds: string[] };
export type MessagesReadUpdateEvent = { sessionId: string; readerId: string; messageIds: string[] };
export type MessageDeletedEvent = { sessionId: string; messageId: string; deletedBy: string };
export type MessageReactionsEvent = { sessionId: string; messageId: string; reactions: Array<{ emoji: string; count: number }> };

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

function getTokenFromExpressRequest(req: Request) {
  const forwarded = req.headers["x-forwarded-cookie"];
  const forwardedCookie =
    typeof forwarded === "string" ? forwarded : Array.isArray(forwarded) ? forwarded.join(";") : undefined;
  const cookies = parseCookieHeader(req.headers.cookie ?? forwardedCookie);
  return cookies[getAuthCookieName()] ?? null;
}

type AuthedRequest = Request & { auth: AuthJwtPayload };

function requireAuth(req: Request, res: Response, next: () => void) {
  const token = getTokenFromExpressRequest(req);
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const payload = verifyAuthToken(token);
  if (!payload) return res.status(401).json({ error: "Unauthorized" });
  (req as AuthedRequest).auth = payload;
  return next();
}

function setAuthCookie(res: Response, token: string) {
  const opts = authCookieOptions();
  res.cookie(getAuthCookieName(), token, { ...opts, maxAge: opts.maxAge * 1000 });
}

function clearAuthCookie(res: Response) {
  const opts = authCookieOptions();
  res.cookie(getAuthCookieName(), "", { ...opts, maxAge: 0 });
}

function oauthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 10
  };
}

function getPublicOrigin(req: Request) {
  const configured = (process.env.PUBLIC_APP_ORIGIN ?? process.env.FRONTEND_ORIGIN ?? process.env.FRONTEND_URL ?? "")
    .split(",")[0]
    ?.trim();
  if (configured) return configured;

  const protoHeader = (req.headers["x-forwarded-proto"] ?? "").toString();
  const proto = protoHeader.split(",")[0]?.trim() || "http";
  const hostHeader = (req.headers["x-forwarded-host"] ?? req.headers.host ?? "").toString();
  const host = hostHeader.split(",")[0]?.trim();
  return host ? `${proto}://${host}` : "";
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
  const isDev = process.env.NODE_ENV !== "production";

  const io = new SocketIOServer(server, {
    ...(isDev ? { transports: ["polling"] as const, allowUpgrades: false } : {}),
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
            sender: created.sender,
            reactions: []
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
              sender: aiMsg.sender,
              reactions: []
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
      "delete_message",
      async (
        payload: { sessionId: string; messageId: string },
        ack?: (resp: { ok: true } | { error: string }) => void
      ) => {
        try {
          const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
          const messageId = typeof payload?.messageId === "string" ? payload.messageId : "";
          if (!sessionId || !messageId) {
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

          const msg = await prisma.message.findUnique({
            where: { id: messageId },
            select: { id: true, sessionId: true, senderId: true }
          });

          // Avoid leaking existence across sessions.
          if (!msg || msg.sessionId !== sessionId) {
            ack?.({ error: "Not found" });
            return;
          }

          if (msg.senderId !== user.userId) {
            ack?.({ error: "Forbidden" });
            return;
          }

          await prisma.message.delete({ where: { id: messageId } });

          io.to(`session:${sessionId}`).emit(
            "message_deleted",
            { sessionId, messageId, deletedBy: user.userId } satisfies MessageDeletedEvent
          );
          ack?.({ ok: true });
        } catch {
          ack?.({ error: "Failed to delete message" });
        }
      }
    );

    socket.on(
      "react_message",
      async (
        payload: { sessionId: string; messageId: string; emoji: string },
        ack?: (resp: { ok: true; reactions: MessageReactionsEvent["reactions"] } | { error: string }) => void
      ) => {
        try {
          const sessionId = typeof payload?.sessionId === "string" ? payload.sessionId : "";
          const messageId = typeof payload?.messageId === "string" ? payload.messageId : "";
          const emoji = typeof payload?.emoji === "string" ? payload.emoji.trim() : "";
          if (!sessionId || !messageId || !emoji) {
            ack?.({ error: "Invalid payload" });
            return;
          }
          if (emoji.length > 16) {
            ack?.({ error: "Invalid emoji" });
            return;
          }

          const participant = await prisma.participant.findUnique({
            where: { userId_sessionId: { userId: user.userId, sessionId } }
          });
          if (!participant) {
            ack?.({ error: "Unauthorized" });
            return;
          }

          const msg = await prisma.message.findUnique({
            where: { id: messageId },
            select: { id: true, sessionId: true }
          });
          if (!msg || msg.sessionId !== sessionId) {
            ack?.({ error: "Not found" });
            return;
          }

          const existing = await prisma.messageReaction.findUnique({
            where: { messageId_userId: { messageId, userId: user.userId } },
            select: { id: true, emoji: true }
          });

          if (existing) {
            if (existing.emoji === emoji) {
              await prisma.messageReaction.delete({ where: { id: existing.id } });
            } else {
              await prisma.messageReaction.update({ where: { id: existing.id }, data: { emoji } });
            }
          } else {
            await prisma.messageReaction.create({ data: { messageId, userId: user.userId, emoji } });
          }

          const grouped = await prisma.messageReaction.groupBy({
            by: ["emoji"],
            where: { messageId },
            _count: { _all: true }
          });
          const reactions = grouped
            .map((g) => ({ emoji: g.emoji, count: g._count._all }))
            .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));

          io.to(`session:${sessionId}`).emit(
            "message_reactions",
            { sessionId, messageId, reactions } satisfies MessageReactionsEvent
          );
          ack?.({ ok: true, reactions });
        } catch {
          ack?.({ error: "Failed to react" });
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

// ---- Backend server bootstrap (REST + Socket.IO) ----

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

// Express 4 does not reliably catch rejected promises from async route handlers.
// Wrap all async handlers to avoid crashing the process on DB/network errors.
function asyncHandler(
  fn: (req: Request, res: Response, next: (err?: unknown) => void) => unknown | Promise<unknown>
) {
  return (req: Request, res: Response, next: (err?: unknown) => void) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

app.get("/healthz", (_req: Request, res: Response) => res.status(200).send("ok"));

// The frontend currently calls `/api/socket` as a "warmup" to ensure the socket server exists.
// In the standalone server we keep this endpoint, but it does not bootstrap Next.js or any Socket.IO server.
app.get("/api/socket", (_req: Request, res: Response) => res.status(204).end());

app.get("/api/online-users", (_req: Request, res: Response) => res.json({ onlineUsers: getOnlineUsers() }));

// ---- Auth routes ----

type LoginBody = { email?: string; password?: string };
app.post("/api/auth/login", asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as LoginBody;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !email.includes("@") || !password) {
    return res.status(400).json({ error: "Invalid credentials" });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      password: true,
      name: true,
      image: true,
      createdAt: true
    }
  });

  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = signAuthToken({ sub: user.id, email: user.email });
  setAuthCookie(res, token);
  return res.status(200).json({
    user: { id: user.id, email: user.email, name: user.name, image: user.image, createdAt: user.createdAt }
  });
}));

type RegisterBody = { name?: string; email?: string; image?: string; password?: string };
app.post("/api/auth/register", asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as RegisterBody;
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : null;
  const image = typeof body.image === "string" ? body.image.trim() : null;

  if (!email || !email.includes("@")) return res.status(400).json({ error: "Invalid email" });
  if (!password || password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: "Email already in use" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: {
      email,
      password: passwordHash,
      name: name || undefined,
      image: image || undefined
    },
    select: { id: true, name: true, email: true, image: true, createdAt: true }
  });

  const token = signAuthToken({ sub: user.id, email: user.email });
  setAuthCookie(res, token);
  return res.status(201).json({ user });
}));

app.post("/api/auth/logout", asyncHandler(async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  return res.status(200).json({ ok: true });
}));

app.get("/api/auth/google", asyncHandler(async (req: Request, res: Response) => {
  const origin = getPublicOrigin(req);
  const next = typeof req.query.next === "string" ? req.query.next : "/chat";

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
  if (!clientId || !redirectUri || !origin) {
    const loginUrl = new URL("/login", origin || "http://localhost:3000");
    loginUrl.searchParams.set("error", "google_not_configured");
    return res.redirect(loginUrl.toString());
  }

  const state = crypto.randomUUID();
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", clientId);
  auth.searchParams.set("redirect_uri", redirectUri);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "openid email profile");
  auth.searchParams.set("state", state);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");

  const o = oauthStateCookieOptions();
  res.cookie("google_oauth_state", state, { ...o, maxAge: o.maxAge * 1000 });
  res.cookie("google_oauth_next", next, { ...o, maxAge: o.maxAge * 1000 });
  return res.redirect(auth.toString());
}));

type TokenResponse = {
  access_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
};
type GoogleUserInfo = { email?: string; name?: string; picture?: string };

app.get("/api/auth/google/callback", asyncHandler(async (req: Request, res: Response) => {
  const origin = getPublicOrigin(req) || "http://localhost:3000";
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";

  const cookieMap = parseCookieHeader(req.headers.cookie);
  const expectedState = cookieMap["google_oauth_state"] ?? "";
  const next = cookieMap["google_oauth_next"] ?? "/chat";

  if (!code || !state || !expectedState || state !== expectedState) {
    return res.redirect(new URL("/login", origin).toString());
  }

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? "";
  if (!clientId || !clientSecret || !redirectUri) {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("error", "google_not_configured");
    return res.redirect(loginUrl.toString());
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code"
    })
  });

  if (!tokenRes.ok) return res.redirect(new URL("/login", origin).toString());
  const tokenJson = (await tokenRes.json()) as TokenResponse;
  const accessToken = tokenJson.access_token;
  if (!accessToken) return res.redirect(new URL("/login", origin).toString());

  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!userRes.ok) return res.redirect(new URL("/login", origin).toString());
  const userInfo = (await userRes.json()) as GoogleUserInfo;

  const email = typeof userInfo.email === "string" ? userInfo.email.toLowerCase() : "";
  const name = typeof userInfo.name === "string" ? userInfo.name : null;
  const picture = typeof userInfo.picture === "string" ? userInfo.picture : null;
  if (!email || !email.includes("@")) return res.redirect(new URL("/login", origin).toString());

  const randomPasswordHash = await bcrypt.hash(`google-${crypto.randomUUID()}`, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name: name ?? undefined, image: picture ?? undefined },
    create: { email, name: name ?? undefined, image: picture ?? undefined, password: randomPasswordHash },
    select: { id: true, email: true }
  });

  const jwt = signAuthToken({ sub: user.id, email: user.email });
  setAuthCookie(res, jwt);
  res.cookie("google_oauth_state", "", { path: "/", maxAge: 0 });
  res.cookie("google_oauth_next", "", { path: "/", maxAge: 0 });
  return res.redirect(new URL(next, origin).toString());
}));

// ---- Protected REST routes ----

app.get("/api/users", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const me = (req as AuthedRequest).auth;
  const users = await prisma.user.findMany({
    where: { id: { not: me.sub } },
    orderBy: [{ name: "asc" }, { email: "asc" }],
    select: { id: true, name: true, email: true, image: true, bio: true }
  });
  return res.json({ users });
}));

app.get("/api/users/:userId", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const userId = typeof req.params.userId === "string" ? req.params.userId : "";
  if (!userId) return res.status(400).json({ error: "Missing userId" });

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true, bio: true, createdAt: true }
  });
  if (!user) return res.status(404).json({ error: "Not found" });
  return res.json({ user });
}));

type SessionBody = { userId?: string };
app.post("/api/chat/session", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const me = (req as AuthedRequest).auth;
  const body = (req.body ?? {}) as SessionBody;

  const otherUserId = typeof body.userId === "string" ? body.userId : "";
  if (!otherUserId) return res.status(400).json({ error: "Missing userId" });
  if (otherUserId === me.sub) return res.status(400).json({ error: "Invalid userId" });

  const candidates = await prisma.chatSession.findMany({
    where: { type: "direct", participants: { some: { userId: me.sub } } },
    include: { participants: true },
    orderBy: { createdAt: "desc" }
  });

  const existing = candidates.find((s) => {
    if (s.participants.length !== 2) return false;
    const ids = new Set(s.participants.map((p) => p.userId));
    return ids.has(me.sub) && ids.has(otherUserId);
  });

  if (existing) return res.json({ sessionId: existing.id });

  const created = await prisma.chatSession.create({
    data: { type: "direct", participants: { create: [{ userId: me.sub }, { userId: otherUserId }] } },
    select: { id: true }
  });
  return res.status(201).json({ sessionId: created.id });
}));

type SessionRow = { sessionId: string; userId: string };
app.get("/api/chat/sessions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const me = (req as AuthedRequest).auth;
  const sessions = await prisma.chatSession.findMany({
    where: { type: "direct", participants: { some: { userId: me.sub } } },
    include: { participants: { select: { userId: true } } },
    orderBy: { createdAt: "desc" }
  });

  const out: SessionRow[] = [];
  for (const s of sessions) {
    if (s.participants.length !== 2) continue;
    const other = s.participants.find((p) => p.userId !== me.sub);
    if (!other?.userId) continue;
    out.push({ sessionId: s.id, userId: other.userId });
  }
  return res.json({ sessions: out });
}));

// ---- Profile (public fields) ----

app.get("/api/me", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const me = (req as AuthedRequest).auth;

  const user = await prisma.user.findUnique({
    where: { id: me.sub },
    select: { id: true, email: true, name: true, image: true, bio: true, createdAt: true }
  });

  if (!user) return res.status(404).json({ error: "Not found" });
  return res.json({ user });
}));

type UpdateProfileBody = { name?: unknown; image?: unknown; bio?: unknown };
app.put("/api/me/profile", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const me = (req as AuthedRequest).auth;
  const body = (req.body ?? {}) as UpdateProfileBody;

  const nameRaw = body.name;
  const imageRaw = body.image;
  const bioRaw = body.bio;

  function normalizeOptionalText(v: unknown, maxLen: number) {
    if (v === undefined) return { ok: true as const, value: undefined as string | null | undefined };
    if (v === null) return { ok: true as const, value: null as null };
    if (typeof v !== "string") return { ok: false as const, error: "Invalid payload" };
    const trimmed = v.trim();
    if (!trimmed) return { ok: true as const, value: null as null };
    if (trimmed.length > maxLen) return { ok: false as const, error: `Must be <= ${maxLen} characters` };
    return { ok: true as const, value: trimmed };
  }

  const name = normalizeOptionalText(nameRaw, 50);
  if (!name.ok) return res.status(400).json({ error: name.error });

  const bio = normalizeOptionalText(bioRaw, 280);
  if (!bio.ok) return res.status(400).json({ error: bio.error });

  // image: allow http(s) URL only (or null/empty to clear)
  let image: string | null | undefined = undefined;
  if (imageRaw !== undefined) {
    if (imageRaw === null) {
      image = null;
    } else if (typeof imageRaw !== "string") {
      return res.status(400).json({ error: "Invalid payload" });
    } else {
      const trimmed = imageRaw.trim();
      if (!trimmed) {
        image = null;
      } else if (!/^https?:\/\//i.test(trimmed)) {
        return res.status(400).json({ error: "Avatar URL must start with http:// or https://" });
      } else if (trimmed.length > 2048) {
        return res.status(400).json({ error: "Avatar URL is too long" });
      } else {
        image = trimmed;
      }
    }
  }

  const updated = await prisma.user.update({
    where: { id: me.sub },
    data: {
      ...(name.value !== undefined ? { name: name.value } : {}),
      ...(bio.value !== undefined ? { bio: bio.value } : {}),
      ...(image !== undefined ? { image } : {})
    },
    select: { id: true, email: true, name: true, image: true, bio: true, createdAt: true }
  });

  return res.json({ user: updated });
}));

app.post("/api/chat/ai-session", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const me = (req as AuthedRequest).auth;
  const aiUser = await getOrCreateAiUser();

  const candidates = await prisma.chatSession.findMany({
    where: { type: "ai", participants: { some: { userId: me.sub } } },
    include: { participants: true },
    orderBy: { createdAt: "desc" }
  });

  const existing = candidates.find((s) => {
    if (s.participants.length !== 2) return false;
    const ids = new Set(s.participants.map((p) => p.userId));
    return ids.has(me.sub) && ids.has(aiUser.id);
  });
  if (existing) return res.json({ sessionId: existing.id });

  const created = await prisma.chatSession.create({
    data: { type: "ai", participants: { create: [{ userId: me.sub }, { userId: aiUser.id }] } },
    select: { id: true }
  });
  return res.status(201).json({ sessionId: created.id });
}));

// Backend-only: used to remove Prisma access from the Next.js frontend page.
app.get("/api/chat/session/:sessionId/bootstrap", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const me = (req as AuthedRequest).auth;
  const sessionId = typeof req.params.sessionId === "string" ? req.params.sessionId : "";
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });

  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: { participants: { include: { user: { select: { id: true, name: true, email: true, image: true } } } } }
  });
  if (!session) return res.status(404).json({ error: "Not found" });
  const isMember = session.participants.some((p) => p.userId === me.sub);
  if (!isMember) return res.status(404).json({ error: "Not found" });

  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    include: { sender: { select: { id: true, name: true, email: true, image: true } } }
  });

  const messageIds = messages.map((m) => m.id);
  const reactionGroups =
    messageIds.length === 0
      ? []
      : await prisma.messageReaction.groupBy({
          by: ["messageId", "emoji"],
          where: { messageId: { in: messageIds } },
          _count: { _all: true }
        });

  const reactionsByMessageId = new Map<string, Array<{ emoji: string; count: number }>>();
  for (const g of reactionGroups) {
    const list = reactionsByMessageId.get(g.messageId) ?? [];
    list.push({ emoji: g.emoji, count: g._count._all });
    reactionsByMessageId.set(g.messageId, list);
  }
  for (const [id, list] of reactionsByMessageId) {
    list.sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
    reactionsByMessageId.set(id, list);
  }

  return res.json({
    meUserId: me.sub,
    sessionId,
    participants: session.participants.map((p) => p.user),
    initialMessages: messages.map((m) => ({
      id: m.id,
      content: m.content,
      role: m.role,
      senderId: m.senderId,
      sessionId: m.sessionId,
      createdAt: m.createdAt.toISOString(),
      sender: m.sender,
      reactions: reactionsByMessageId.get(m.id) ?? []
    }))
  });
}));

// Last-resort error handler (keeps the process alive).
app.use((err: unknown, _req: Request, res: Response, _next: (err?: unknown) => void) => {
  // eslint-disable-next-line no-console
  console.error("[backend] unhandled error", err);
  if (res.headersSent) return;

  const anyErr = err as { statusCode?: unknown; status?: unknown; type?: unknown };
  const statusCode =
    typeof anyErr?.statusCode === "number"
      ? anyErr.statusCode
      : typeof anyErr?.status === "number"
        ? anyErr.status
        : 500;

  // JSON parse errors should be 400, not 500.
  if (statusCode >= 400 && statusCode < 500) {
    const isBadJson = anyErr?.type === "entity.parse.failed";
    return res.status(statusCode).json({ error: isBadJson ? "Invalid JSON" : "Bad Request" });
  }

  res.status(500).json({ error: "Internal Server Error" });
});

const httpServer = createServer(app);
attachSocketServer(httpServer);

httpServer.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[backend] listening on :${PORT}`);
});

