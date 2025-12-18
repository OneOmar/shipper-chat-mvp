"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Socket } from "socket.io-client";
import { useChatShell } from "../ChatShell";
import { createClientSocket } from "@/lib/socket-client";

type User = { id: string; name: string | null; email: string; image: string | null };

type Message = {
  id: string;
  content: string;
  role: "user" | "assistant";
  senderId: string;
  sessionId: string;
  createdAt: string;
  sender: User;
  reactions?: Array<{ emoji: string; count: number }>;
};

type AiMessageStartEvent = { tempId: string; sessionId: string; sender: User };
type AiMessageDeltaEvent = { tempId: string; sessionId: string; delta: string; content: string };
type AiMessageDoneEvent = { tempId: string; sessionId: string; message: Message };

type TypingEvent = { sessionId: string; userId: string };
type MessagesReadUpdateEvent = { sessionId: string; readerId: string; messageIds: string[] };
type MessageDeletedEvent = { sessionId: string; messageId: string; deletedBy: string };
type MessageReactionsEvent = { sessionId: string; messageId: string; reactions: Array<{ emoji: string; count: number }> };

function isAi(sender: User) {
  return sender.name === "AI" || sender.email === "ai@local";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Typing indicator (frontend-only, auto-clears)
  const [typingUserIds, setTypingUserIds] = useState<Set<string>>(new Set());
  const typingClearTimersRef = useRef<Map<string, number>>(new Map());
  const isTypingRef = useRef(false);
  const typingStopTimerRef = useRef<number | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [myReactionByMessageId, setMyReactionByMessageId] = useState<Record<string, string | null>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [messageMenu, setMessageMenu] = useState<null | {
    messageId: string;
    mine: boolean;
    content: string;
    anchor: { top: number; left: number; right: number; bottom: number; width: number; height: number };
    placement: "above" | "below";
    pos: { top: number; left: number };
  }>(null);

  // Read receipts (frontend-only)
  const [readByOtherIds, setReadByOtherIds] = useState<Set<string>>(new Set());
  const sentReadIdsRef = useRef<Set<string>>(new Set());

  const title = useMemo(() => {
    const other = participants.find((p) => p.id !== meUserId);
    return other?.name || other?.email || "Chat";
  }, [participants, meUserId]);

  const otherUser = useMemo(() => participants.find((p) => p.id !== meUserId) ?? null, [participants, meUserId]);
  const canViewProfile = !!otherUser && !isAi(otherUser);

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

  const handleMessageDeleted = useCallback(
    (evt: MessageDeletedEvent) => {
      if (evt.sessionId !== sessionId) return;
      setMessages((prev) => prev.filter((m) => m.id !== evt.messageId));
      setSelectedMessageId((prev) => (prev === evt.messageId ? null : prev));
      setMyReactionByMessageId((prev) => {
        if (!(evt.messageId in prev)) return prev;
        const next = { ...prev };
        delete next[evt.messageId];
        return next;
      });
      setReadByOtherIds((prev) => {
        if (!prev.has(evt.messageId)) return prev;
        const next = new Set(prev);
        next.delete(evt.messageId);
        return next;
      });
      sentReadIdsRef.current.delete(evt.messageId);
    },
    [sessionId]
  );

  const handleMessageReactions = useCallback(
    (evt: MessageReactionsEvent) => {
      if (evt.sessionId !== sessionId) return;
      setMessages((prev) => prev.map((m) => (m.id === evt.messageId ? { ...m, reactions: evt.reactions } : m)));
    },
    [sessionId]
  );

  useEffect(() => {
    if (!messageMenu) return;
    const el = menuRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const pad = 10;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const desiredLeft = messageMenu.anchor.left + messageMenu.anchor.width / 2 - rect.width / 2;
    const left = clamp(desiredLeft, pad, vw - rect.width - pad);

    const aboveTop = messageMenu.anchor.top - rect.height - 8;
    const belowTop = messageMenu.anchor.bottom + 8;
    const canPlaceAbove = aboveTop >= pad;
    const canPlaceBelow = belowTop + rect.height <= vh - pad;

    const placement =
      messageMenu.placement === "above"
        ? canPlaceAbove
          ? "above"
          : "below"
        : canPlaceBelow
          ? "below"
          : "above";

    const top = clamp(placement === "above" ? aboveTop : belowTop, pad, vh - rect.height - pad);

    if (Math.abs(messageMenu.pos.left - left) > 0.5 || Math.abs(messageMenu.pos.top - top) > 0.5) {
      setMessageMenu((prev) => (prev ? { ...prev, placement, pos: { top, left } } : prev));
    }
  }, [messageMenu]);

  useEffect(() => {
    if (!messageMenu) {
      setMenuOpen(false);
      return;
    }
    // Trigger enter animation after mount.
    setMenuOpen(false);
    window.requestAnimationFrame(() => setMenuOpen(true));
  }, [messageMenu]);

  function closeMessageMenu() {
    setMenuOpen(false);
    // Allow exit animation to play before unmount.
    window.setTimeout(() => setMessageMenu(null), 120);
  }

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

      s = createClientSocket();
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

      s.on("message_deleted", handleMessageDeleted);
      s.on("message_reactions", handleMessageReactions);

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
  }, [
    sessionId,
    reconnectKey,
    emitReadForVisibleChat,
    clearRemoteTyping,
    setRemoteTyping,
    meUserId,
    handleMessageDeleted,
    handleMessageReactions
  ]);

  useEffect(() => {
    // Reset ephemeral state when switching chats.
    sentReadIdsRef.current = new Set();
    setReadByOtherIds(new Set());
    setTypingUserIds(new Set());
    isTypingRef.current = false;
    setSelectedMessageId(null);
    setMyReactionByMessageId({});
    setMessageMenu(null);
    setMenuOpen(false);
  }, [sessionId]);

  async function deleteMyMessage(messageId: string) {
    const s = socketRef.current;
    if (!s || !connectedRef.current || !joinedRef.current) return;
    setError(null);

    // Optimistic remove.
    let snapshot: Message[] | null = null;
    setMessages((prev) => {
      snapshot = prev;
      return prev.filter((m) => m.id !== messageId);
    });

    s.emit("delete_message", { sessionId, messageId }, (resp: { ok: true } | { error: string }) => {
      if (!resp || ("error" in resp && resp.error)) {
        // Restore on failure.
        if (snapshot) setMessages(snapshot);
        setError("Failed to delete message");
      }
    });
  }

  async function reactToMessage(messageId: string, emoji: string) {
    const s = socketRef.current;
    if (!s || !connectedRef.current || !joinedRef.current) return;

    setMyReactionByMessageId((prev) => {
      const current = prev[messageId] ?? null;
      return { ...prev, [messageId]: current === emoji ? null : emoji };
    });

    s.emit(
      "react_message",
      { sessionId, messageId, emoji },
      (resp: { ok: true; reactions: MessageReactionsEvent["reactions"] } | { error: string }) => {
        if (!resp || "error" in resp) return;
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, reactions: resp.reactions } : m)));
      }
    );
  }

  async function copyMessage(text: string) {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
    } catch {
      // fall through
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    } catch {
      // ignore
    }
  }

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

  const quickEmojis = useMemo(
    () => ["👍", "❤️", "😂", "🎉", "🙏", "🔥", "✅", "👀", "🤝", "😄", "😅", "😮"] as const,
    []
  );

  function focusComposer() {
    // Ensure focus after state updates / disabled toggles.
    window.setTimeout(() => composerRef.current?.focus(), 0);
  }

  function insertEmojiAtCursor(emoji: string) {
    const el = composerRef.current;
    const currentValue = el?.value ?? content;
    const start = el?.selectionStart ?? currentValue.length;
    const end = el?.selectionEnd ?? currentValue.length;

    const next = `${currentValue.slice(0, start)}${emoji}${currentValue.slice(end)}`;
    const nextCaret = start + emoji.length;

    setContent(next);

    window.setTimeout(() => {
      const node = composerRef.current;
      if (!node) return;
      node.focus();
      try {
        node.setSelectionRange(nextCaret, nextCaret);
      } catch {
        // ignore
      }
    }, 0);
  }

  async function send() {
    const text = content.trim();
    if (!text || !socket || !connected || !joined) return;
    setError(null);
    setSending(true);
    setContent("");
    setEmojiOpen(false);
    focusComposer();
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
          focusComposer();
          return;
        }
        setMessages((prev) => {
          if (prev.some((m) => m.id === resp.id)) return prev;
          return [...prev, resp];
        });
        focusComposer();
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
          <div className="flex items-center gap-3">
            {canViewProfile ? (
              <Link
                href={`/users/${encodeURIComponent(otherUser.id)}`}
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-900"
              >
                View profile
              </Link>
            ) : null}
            <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className={["h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-zinc-600"].join(" ")} />
            <span>{connected ? (joined ? "Connected" : "Joining…") : "Disconnected"}</span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-4"
        onClick={() => {
          setSelectedMessageId(null);
          closeMessageMenu();
        }}
      >
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
              const isPersisted = !m.id.startsWith("temp:");
              const isSelected = selectedMessageId === m.id;
              const reactions = m.reactions ?? [];
              const myReaction = myReactionByMessageId[m.id] ?? null;
              return (
                <div key={m.id} className={mine ? "flex justify-end" : "flex justify-start"}>
                  <div
                    className={["flex max-w-[90%] items-end gap-2", mine ? "justify-end" : "justify-start"].join(" ")}
                  >
                    {mine ? null : <MiniAvatar sender={m.sender} />}
                    <div className="relative group">
                      {/* Hover / desktop trigger (WhatsApp-style) */}
                      {isPersisted ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const anchor = {
                              top: r.top,
                              left: r.left,
                              right: r.right,
                              bottom: r.bottom,
                              width: r.width,
                              height: r.height
                            };
                            setSelectedMessageId(m.id);
                            setMessageMenu({
                              messageId: m.id,
                              mine,
                              content: m.content,
                              anchor,
                              placement: "above",
                              pos: {
                                top: clamp(anchor.top - 240, 10, window.innerHeight - 10),
                                left: clamp(anchor.left + anchor.width / 2 - 140, 10, window.innerWidth - 10)
                              }
                            });
                          }}
                          aria-label="Message menu"
                          className={[
                            "hidden md:inline-flex absolute top-1 z-10 h-6 w-6 items-center justify-center rounded-full border border-zinc-800 bg-zinc-950/80 text-xs text-zinc-200 shadow-sm",
                            "opacity-0 transition-opacity group-hover:opacity-100",
                            // Place on inner top corner
                            mine ? "left-1" : "right-1"
                          ].join(" ")}
                        >
                          <span aria-hidden="true" className="text-base leading-none">
                            ˅
                          </span>
                        </button>
                      ) : null}

                      <div
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isPersisted) return;
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                          const anchor = {
                            top: r.top,
                            left: r.left,
                            right: r.right,
                            bottom: r.bottom,
                            width: r.width,
                            height: r.height
                          };
                          setSelectedMessageId(m.id);
                          setMessageMenu({
                            messageId: m.id,
                            mine,
                            content: m.content,
                            anchor,
                            placement: "above",
                            pos: {
                              top: clamp(anchor.top - 240, 10, window.innerHeight - 10),
                              left: clamp(anchor.left + anchor.width / 2 - 140, 10, window.innerWidth - 10)
                            }
                          });
                        }}
                        className={[
                          "rounded-2xl px-3 py-2 text-sm",
                          isPersisted && isSelected ? "ring-2 ring-zinc-400/40" : "",
                          mine
                            ? "bg-zinc-100 text-zinc-900"
                            : isAi(m.sender)
                              ? "bg-indigo-950/40 text-zinc-100 border border-indigo-900/50"
                              : "bg-zinc-900/60 text-zinc-100 border border-zinc-800"
                        ].join(" ")}
                      >
                        <div className="whitespace-pre-wrap break-words">{m.content}</div>

                        <div className={["mt-1 flex items-center justify-between gap-2 text-[11px]", mine ? "text-zinc-600" : "text-zinc-400"].join(" ")}>
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

                      {/* Reactions chip (WhatsApp-like placement: hugs the bubble) */}
                      {reactions.length ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isPersisted) return;
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            const anchor = {
                              top: r.top,
                              left: r.left,
                              right: r.right,
                              bottom: r.bottom,
                              width: r.width,
                              height: r.height
                            };
                            setSelectedMessageId(m.id);
                            setMessageMenu({
                              messageId: m.id,
                              mine,
                              content: m.content,
                              anchor,
                              placement: "above",
                              pos: {
                                top: clamp(anchor.top - 240, 10, window.innerHeight - 10),
                                left: clamp(anchor.left + anchor.width / 2 - 140, 10, window.innerWidth - 10)
                              }
                            });
                          }}
                          className={[
                            "absolute -bottom-2 z-10 inline-flex items-center gap-1 rounded-full border border-zinc-800 bg-zinc-950/90 px-2 py-0.5 text-[11px] text-zinc-100 shadow-sm",
                            // Place on inner bottom corner (matches WhatsApp screenshot)
                            mine ? "left-2" : "right-2"
                          ].join(" ")}
                          aria-label="Message reactions"
                        >
                          {reactions.slice(0, 3).map((r) => (
                            <span key={`${m.id}:chip:${r.emoji}`} className={myReaction === r.emoji ? "text-zinc-100" : "text-zinc-200"}>
                              {r.emoji}
                            </span>
                          ))}
                          <span className="text-zinc-400">
                            {reactions.reduce((sum, r) => sum + (r.count || 0), 0)}
                          </span>
                        </button>
                      ) : null}
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

        <div className="flex items-center gap-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setEmojiOpen((v) => !v)}
              disabled={!canType}
              aria-label="Open emoji picker"
              aria-expanded={emojiOpen}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-800 bg-zinc-950/60 text-lg text-zinc-200 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-70"
            >
              🙂
            </button>

            {emojiOpen ? (
              <div className="absolute bottom-12 left-0 z-10 w-56 rounded-2xl border border-zinc-800 bg-zinc-950 p-2 shadow-lg">
                <div className="grid grid-cols-6 gap-1">
                  {quickEmojis.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => {
                        setEmojiOpen(false);
                        if (!canType) return;
                        insertEmojiAtCursor(emoji);
                      }}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-xl hover:bg-zinc-900"
                      aria-label={`Insert ${emoji}`}
                    >
                      <span className="text-lg leading-none">{emoji}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-zinc-500">Click to insert into the message.</div>
              </div>
            ) : null}
          </div>

          <textarea
            ref={composerRef}
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
            rows={1}
            disabled={!canType}
            className="h-11 flex-1 resize-none overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-zinc-600"
          />
          <button
            type="button"
            onClick={send}
            disabled={!canType || !content.trim()}
            aria-label="Send message"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900 hover:bg-white disabled:cursor-not-allowed disabled:opacity-70"
          >
            {sending ? (
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" aria-hidden="true" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>
        <div className="mt-2 text-xs text-zinc-500">
          {connected ? (joined ? "Enter to send • Shift+Enter for newline" : "Joining session…") : "Disconnected — messages are disabled."}
        </div>
      </div>

      {/* WhatsApp-style floating message menu */}
      {messageMenu ? (
        <div
          className="fixed inset-0 z-50"
          onClick={() => {
            setSelectedMessageId(null);
            closeMessageMenu();
          }}
        >
          <div
            ref={menuRef}
            className={[
              "w-[260px] rounded-2xl border border-zinc-800 bg-zinc-950/95 shadow-xl",
              "transform transition-all duration-150 ease-out",
              menuOpen ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 -translate-y-1"
            ].join(" ")}
            style={{ position: "fixed", top: messageMenu.pos.top, left: messageMenu.pos.left }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-1 px-2 py-1.5">
              {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    void reactToMessage(messageMenu.messageId, emoji);
                    setSelectedMessageId(null);
                    closeMessageMenu();
                    focusComposer();
                  }}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-base hover:bg-zinc-900"
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="h-px bg-zinc-800" />

            <div className="p-1.5">
              <button
                type="button"
                onClick={() => {
                  void copyMessage(messageMenu.content);
                  setSelectedMessageId(null);
                  closeMessageMenu();
                  focusComposer();
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900"
              >
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/40 text-zinc-300">
                  ⧉
                </span>
                <span>Copy</span>
              </button>

              {messageMenu.mine ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm("Delete this message?")) return;
                    void deleteMyMessage(messageMenu.messageId);
                    setSelectedMessageId(null);
                    closeMessageMenu();
                    focusComposer();
                  }}
                  className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-red-200 hover:bg-zinc-900"
                >
                  <span className="inline-flex h-6 w-6 items-center justify-center rounded-lg border border-zinc-800 bg-zinc-950/40 text-red-200">
                    <svg
                      viewBox="0 0 24 24"
                      className="h-4 w-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="M19 6l-1 14H6L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                    </svg>
                  </span>
                  <span>Delete</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


