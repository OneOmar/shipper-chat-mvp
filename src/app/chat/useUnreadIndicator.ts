"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Socket } from "socket.io-client";

type ReceiveMessageEvent = {
  id: string;
  content: string;
  role: "user" | "assistant";
  senderId: string;
  sessionId: string;
  createdAt: string;
  sender: { id: string; name: string | null; email: string; image: string | null };
};

type Params = {
  socket: Socket | null;
  activeUserId: string;
  incrementUnread: (userId: string) => void;
  clearUnread: (userId: string) => void;
};

type Value = {
  registerChatSession: (userId: string, sessionId: string) => void;
};

const STORAGE_KEY = "chat:sessionIdByUserId";

type SessionsResponse = { sessions: Array<{ sessionId: string; userId: string }> };

function safeParseRecord(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k !== "string") continue;
      if (typeof v !== "string") continue;
      if (!k || !v) continue;
      out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function useUnreadIndicator({ socket, activeUserId, incrementUnread, clearUnread }: Params): Value {
  const [sessionIdByUserId, setSessionIdByUserId] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Load any previously opened chats (so we can join their sessions quickly).
      const stored = safeParseRecord(typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null);
      if (!cancelled) setSessionIdByUserId(stored);

      // Also load all existing direct sessions for this user (read-only) so unread works even for chats
      // you haven't opened in this browser yet.
      try {
        const res = await fetch("/api/chat/sessions", { credentials: "include" });
        const data = (await res.json().catch(() => null)) as SessionsResponse | null;
        const rows = Array.isArray(data?.sessions) ? data.sessions : [];

        const fromApi: Record<string, string> = {};
        for (const row of rows) {
          if (!row || typeof row !== "object") continue;
          const userId = typeof (row as { userId?: unknown }).userId === "string" ? (row as { userId: string }).userId : "";
          const sessionId =
            typeof (row as { sessionId?: unknown }).sessionId === "string" ? (row as { sessionId: string }).sessionId : "";
          if (!userId || !sessionId) continue;
          fromApi[userId] = sessionId;
        }

        if (cancelled) return;
        setSessionIdByUserId((prev) => {
          const next = { ...prev, ...fromApi };
          try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          } catch {
            // ignore
          }
          return next;
        });
      } catch {
        // ignore
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const userIdBySessionId = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [userId, sessionId] of Object.entries(sessionIdByUserId)) {
      if (!userId || !sessionId) continue;
      out[sessionId] = userId;
    }
    return out;
  }, [sessionIdByUserId]);

  useEffect(() => {
    // Opening a chat should clear its unread count (including back/forward navigation).
    if (!activeUserId || activeUserId === "ai") return;
    clearUnread(activeUserId);
  }, [activeUserId, clearUnread]);

  useEffect(() => {
    if (!socket) return;
    // Join sessions we already know about so we can receive `receive_message` events.
    for (const sessionId of Object.values(sessionIdByUserId)) {
      if (!sessionId) continue;
      socket.emit("join_session", sessionId, () => {});
    }
  }, [socket, sessionIdByUserId]);

  useEffect(() => {
    if (!socket) return;

    const onReceive = (msg: ReceiveMessageEvent) => {
      const userId = userIdBySessionId[msg.sessionId];
      if (!userId) return;
      if (activeUserId === userId) return;
      // Only count messages that come from the other user for that row.
      if (msg.senderId !== userId) return;
      incrementUnread(userId);
    };

    socket.on("receive_message", onReceive);
    return () => {
      socket.off("receive_message", onReceive);
    };
  }, [socket, userIdBySessionId, activeUserId, incrementUnread]);

  const registerChatSession = useCallback(
    (userId: string, sessionId: string) => {
      if (!userId || !sessionId) return;
      setSessionIdByUserId((prev) => {
        if (prev[userId] === sessionId) return prev;
        const next = { ...prev, [userId]: sessionId };
        try {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // ignore
        }
        return next;
      });

      // Join immediately so unread events can start flowing even before navigation completes.
      socket?.emit("join_session", sessionId, () => {});
    },
    [socket]
  );

  return { registerChatSession };
}
