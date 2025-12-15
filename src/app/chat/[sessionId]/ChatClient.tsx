"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { useChatShell } from "../ChatShell";

type User = { id: string; name: string | null; email: string; image: string | null };

type Message = {
  id: string;
  content: string;
  role: "user" | "assistant";
  senderId: string;
  sessionId: string;
  createdAt: string;
  sender: User;
};

type AiMessageStartEvent = { tempId: string; sessionId: string; sender: User };
type AiMessageDeltaEvent = { tempId: string; sessionId: string; delta: string; content: string };
type AiMessageDoneEvent = { tempId: string; sessionId: string; message: Message };

type TypingEvent = { sessionId: string; userId: string };
type MessagesReadUpdateEvent = { sessionId: string; readerId: string; messageIds: string[] };

function isAi(sender: User) {
  return sender.name === "AI" || sender.email === "ai@local";
}

function MiniAvatar({ sender }: { sender: User }) {
  if (isAi(sender)) {
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-semibold text-white">
        AI
      </div>
    );
  }

  const src = sender.image || "/avatar-placeholder.svg";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={sender.name || sender.email}
      className="h-7 w-7 rounded-full object-cover"
      onError={(e) => {
        const el = e.currentTarget;
        if (el.src.endsWith("/avatar-placeholder.svg")) return;
        el.src = "/avatar-placeholder.svg";
      }}
    />
  );
}

export function ChatClient({
  meUserId,
  sessionId,
  participants,
  initialMessages
}: {
  meUserId: string;
  sessionId: string;
  participants: User[];
  initialMessages: Message[];
}) {
  const { openSidebar } = useChatShell();
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const messagesRef = useRef<Message[]>(initialMessages);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const connectedRef = useRef(false);
  const joinedRef = useRef(false);
  const [reconnectKey, setReconnectKey] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Typing indicator (frontend-only, auto-clears)
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const typingClearTimersRef = useRef<Map<string, number>>(new Map());
  const isTypingRef = useRef(false);
  const typingStopTimerRef = useRef<number | null>(null);

  // Read receipts (frontend-only)
  const [readByOtherIds, setReadByOtherIds] = useState<Set<string>>(new Set());
  const sentReadIdsRef = useRef<Set<string>>(new Set());

  const title = useMemo(() => {
    const other = participants.find((p) => p.id !== meUserId);
    return other?.name || other?.email || "Chat";
  }, [participants, meUserId]);

  const otherUser = useMemo(() => participants.find((p) => p.id !== meUserId) ?? null, [participants, meUserId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  useEffect(() => {
    joinedRef.current = joined;
  }, [joined]);

  function emitTypingStart() {
    const s = socketRef.current;
    if (!s || !connectedRef.current || !joinedRef.current) return;
    s.emit("typing:start", { sessionId });
  }

  function emitTypingStop() {
    const s = socketRef.current;
    if (!s || !connectedRef.current || !joinedRef.current) return;
    s.emit("typing:stop", { sessionId });
  }

  function scheduleTypingStop() {
    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = window.setTimeout(() => {
      if (!isTypingRef.current) return;
      isTypingRef.current = false;
      emitTypingStop();
    }, 1200);
  }

  function notifyTyping() {
    if (!connected || !joined) return;
    if (!isTypingRef.current) {
      isTypingRef.current = true;
      emitTypingStart();
    }
    scheduleTypingStop();
  }

  const clearRemoteTyping = useCallback((userId: string) => {
    const t = typingClearTimersRef.current.get(userId);
    if (t) window.clearTimeout(t);
    typingClearTimersRef.current.delete(userId);
    setTypingUserIds((prev) => {
      if (!prev.has(userId)) return prev;
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  const setRemoteTyping = useCallback(
    (userId: string) => {
      setTypingUserIds((prev) => {
        if (prev.has(userId)) return prev;
        const next = new Set(prev);
        next.add(userId);
        return next;
      });
      const existing = typingClearTimersRef.current.get(userId);
      if (existing) window.clearTimeout(existing);
      typingClearTimersRef.current.set(
        userId,
        window.setTimeout(() => clearRemoteTyping(userId), 2500)
      );
    },
    [clearRemoteTyping]
  );

  const emitReadForVisibleChat = useCallback(
    (nextMessages?: Message[]) => {
      const s = socketRef.current;
      if (!s || !connectedRef.current || !joinedRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      const list = nextMessages ?? messagesRef.current;
      const unreadIds = list
        .filter((m) => m.sessionId === sessionId && m.senderId !== meUserId)
        .map((m) => m.id)
        .filter((id) => !sentReadIdsRef.current.has(id));

      if (unreadIds.length === 0) return;
      unreadIds.forEach((id) => sentReadIdsRef.current.add(id));
      s.emit("messages:read", { sessionId, messageIds: unreadIds });
    },
    [sessionId, meUserId]
  );

  useEffect(() => {
    let s: Socket | null = null;
    let cancelled = false;
    const typingTimers = typingClearTimersRef.current;

    async function connect() {
      setError(null);
      setConnected(false);
      setJoined(false);
      // Ensure the Socket.IO server is initialized.
      await fetch("/api/socket", { credentials: "include" });
      if (cancelled) return;

      s = io({ path: "/socket.io", withCredentials: true });
      setSocket(s);
      socketRef.current = s;

      s.on("connect_error", () => setError("Realtime connection failed"));
      s.on("connect", () => setConnected(true));
      s.on("disconnect", () => setConnected(false));

      s.on("receive_message", (msg: Message) => {
        if (msg.sessionId !== sessionId) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === msg.id)) return prev;
          // If a streaming AI temp message exists, drop it once the final arrives.
          const withoutTempAi = prev.filter((m) => !(m.id.startsWith("temp:") && m.role === "assistant"));
          const next = [...withoutTempAi, msg];
          queueMicrotask(() => emitReadForVisibleChat(next));
          return next;
        });
      });

      s.on("ai_message_start", (evt: AiMessageStartEvent) => {
        if (evt.sessionId !== sessionId) return;
        setMessages((prev) => [
          ...prev,
          {
            id: `temp:${evt.tempId}`,
            content: "",
            role: "assistant",
            senderId: evt.sender.id,
            sessionId,
            createdAt: new Date().toISOString(),
            sender: evt.sender
          }
        ]);
      });

      s.on("ai_message_delta", (evt: AiMessageDeltaEvent) => {
        if (evt.sessionId !== sessionId) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === `temp:${evt.tempId}` ? { ...m, content: evt.content } : m))
        );
      });

      s.on("ai_message_done", (evt: AiMessageDoneEvent) => {
        if (evt.sessionId !== sessionId) return;
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== `temp:${evt.tempId}`);
          if (next.some((m) => m.id === evt.message.id)) return next;
          return [...next, evt.message];
        });
      });

      s.on("typing:start", (evt: TypingEvent) => {
        if (evt.sessionId !== sessionId) return;
        if (evt.userId === meUserId) return;
        setRemoteTyping(evt.userId);
      });

      s.on("typing:stop", (evt: TypingEvent) => {
        if (evt.sessionId !== sessionId) return;
        if (evt.userId === meUserId) return;
        clearRemoteTyping(evt.userId);
      });

      s.on("messages:read:update", (evt: MessagesReadUpdateEvent) => {
        if (evt.sessionId !== sessionId) return;
        if (evt.readerId === meUserId) return;
        setReadByOtherIds((prev) => {
          const next = new Set(prev);
          for (const id of evt.messageIds) next.add(id);
          return next;
        });
      });

      s.emit("join_session", sessionId, (ok: boolean) => {
        setJoined(ok);
        if (!ok) setError("Unable to join session");
        // Apply read receipts instantly on open: the initial "focus/visible" effect can run
        // before we join the room, so we explicitly emit once join succeeds.
        if (ok) queueMicrotask(() => emitReadForVisibleChat());
      });
    }

    connect();
    return () => {
      cancelled = true;
      if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current);
      for (const t of typingTimers.values()) window.clearTimeout(t);
      typingTimers.clear();

      if (isTypingRef.current) {
        isTypingRef.current = false;
        try {
          s?.emit("typing:stop", { sessionId });
        } catch {
          // ignore
        }
      }
      if (s) s.disconnect();
      setSocket(null);
      socketRef.current = null;
    };
  }, [sessionId, reconnectKey, emitReadForVisibleChat, clearRemoteTyping, setRemoteTyping, meUserId]);

  useEffect(() => {
    // Reset ephemeral state when switching chats.
    sentReadIdsRef.current = new Set();
    setReadByOtherIds(new Set());
    setTypingUserIds(new Set());
    isTypingRef.current = false;
  }, [sessionId]);

  useEffect(() => {
    function onFocusOrVisible() {
      emitReadForVisibleChat();
    }
    window.addEventListener("focus", onFocusOrVisible);
    document.addEventListener("visibilitychange", onFocusOrVisible);
    onFocusOrVisible();
    return () => {
      window.removeEventListener("focus", onFocusOrVisible);
      document.removeEventListener("visibilitychange", onFocusOrVisible);
    };
  }, [emitReadForVisibleChat]);

  useEffect(() => {
    // If we connect + join after mount, emit read immediately (no need to wait for focus/visibility events).
    if (!connected || !joined) return;
    emitReadForVisibleChat();
  }, [connected, joined, emitReadForVisibleChat]);

  async function send() {
    const text = content.trim();
    if (!text || !socket || !connected || !joined) return;
    setError(null);
    setSending(true);
    setContent("");
    if (isTypingRef.current) {
      isTypingRef.current = false;
      emitTypingStop();
    }

    socket.emit(
      "send_message",
      { sessionId, content: text },
      (resp: Message | { error: string }) => {
        setSending(false);
        if ("error" in resp) {
          setError(resp.error);
          setContent(text);
          return;
        }
        setMessages((prev) => {
          if (prev.some((m) => m.id === resp.id)) return prev;
          return [...prev, resp];
        });
      }
    );
  }

  function onComposerKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  const canType = connected && joined && !sending;
  const typingLabel = useMemo(() => {
    const ids = Array.from(typingUserIds.values());
    if (ids.length === 0) return null;
    const first = participants.find((p) => p.id === ids[0]);
    const name = first?.name || first?.email || "User";
    return `${name} is typing…`;
  }, [typingUserIds, participants]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 text-zinc-200 hover:bg-zinc-900 md:hidden"
              onClick={openSidebar}
              aria-label="Open sidebar"
            >
              <span className="text-lg leading-none">≡</span>
            </button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-100">{title}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className={["h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-zinc-600"].join(" ")} />
            <span>{connected ? (joined ? "Connected" : "Joining…") : "Disconnected"}</span>
          </div>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-4">
        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/30 px-4 py-3 text-center">
              <div className="text-sm font-medium text-zinc-100">No messages yet</div>
              <div className="mt-1 text-sm text-zinc-400">Send a message to start the conversation.</div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {messages.map((m) => {
              const mine = m.senderId === meUserId;
              const showRead = mine && !!otherUser && readByOtherIds.has(m.id);
              return (
                <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={["flex max-w-[90%] items-end gap-2", mine ? "justify-end" : "justify-start"].join(" ")}
                  >
                    {mine ? null : <MiniAvatar sender={m.sender} />}
                    <div
                      className={[
                        "rounded-2xl px-3 py-2 text-sm",
                        mine
                          ? "bg-zinc-100 text-zinc-900"
                          : isAi(m.sender)
                            ? "bg-indigo-950/40 text-zinc-100 border border-indigo-900/50"
                            : "bg-zinc-900/60 text-zinc-100 border border-zinc-800"
                      ].join(" ")}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                      <div className={["mt-1 text-[11px]", mine ? "text-zinc-600" : "text-zinc-400"].join(" ")}>
                        {mine ? (
                          <span className="inline-flex items-center gap-1">
                            <span>You</span>
                            {showRead ? <span aria-label="Read receipt">✓✓</span> : null}
                          </span>
                        ) : (
                          m.sender.name || m.sender.email
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-zinc-800 px-6 py-4">
        {error ? (
          <div className="mb-3 rounded-lg border border-red-900/60 bg-red-950/30 px-3 py-2 text-sm text-red-200">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">{error}</div>
              <button
                type="button"
                onClick={() => setReconnectKey((k) => k + 1)}
                className="shrink-0 rounded-md border border-red-900/60 bg-red-950/40 px-2 py-1 text-xs text-red-100 hover:bg-red-950/60"
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}

        {typingLabel ? (
          <div className="mb-2 text-xs text-zinc-500">{typingLabel}</div>
        ) : (
          <div className="mb-2 h-[16px]" />
        )}

        <div className="flex items-end gap-3">
          <textarea
            value={content}
            onChange={(e) => {
              const next = e.target.value;
              setContent(next);
              if (canType && next.trim().length > 0) notifyTyping();
              if (canType && next.trim().length === 0 && isTypingRef.current) {
                isTypingRef.current = false;
                emitTypingStop();
              }
            }}
            onBlur={() => {
              if (!isTypingRef.current) return;
              isTypingRef.current = false;
              emitTypingStop();
            }}
            onKeyDown={onComposerKeyDown}
            placeholder="Type a message…"
            rows={2}
            disabled={!canType}
            className="min-h-[44px] flex-1 resize-none rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
          />
          <button
            type="button"
            onClick={send}
            disabled={!canType || !content.trim()}
            className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-100 px-4 text-sm font-medium text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          {connected ? (joined ? "Enter to send • Shift+Enter for newline" : "Joining session…") : "Disconnected — messages are disabled."}
        </div>
      </div>
    </div>
  );
}


