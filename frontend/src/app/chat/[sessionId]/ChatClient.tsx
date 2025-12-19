"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Socket } from "socket.io-client";
import { useChatShell } from "../ChatShell";
import { createClientSocket } from "@/lib/socket-client";
import { IconChevronDown, IconCopy, IconMenu, IconSend, IconSmile, IconTrash } from "@/app/_components/icons";

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
type MessagesReadUpdateEvent = { sessionId: string; readerId: string; messageIds: string[]; readAt?: string };
type MessageDeletedEvent = { sessionId: string; messageId: string; deletedBy: string };
type MessageReactionsEvent = { sessionId: string; messageId: string; reactions: Array<{ emoji: string; count: number }> };

function isAi(sender: User) {
  return sender.name === "AI" || sender.email === "ai@local";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function startOfLocalDayMs(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function dateSeparatorLabel(iso: string) {
  const d = new Date(iso);
  const t = d.getTime();
  if (!Number.isFinite(t)) return "";

  const now = new Date();
  const todayStart = startOfLocalDayMs(now);
  const dayStart = startOfLocalDayMs(d);
  const diffDays = Math.round((todayStart - dayStart) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";

  try {
    return d.toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function MiniAvatar({ sender }: { sender: User }) {
  if (isAi(sender)) {
    return (
      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-chat-primary text-[10px] font-semibold text-chat-primary-foreground">
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
  initialMessages,
  lastReadAtByUserId
}: {
  meUserId: string;
  sessionId: string;
  participants: User[];
  initialMessages: Message[];
  lastReadAtByUserId: Record<string, string>;
}) {
  const { openSidebar, onlineUserIds } = useChatShell();
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

  // Read receipts (persisted via participant.lastReadAt on backend)
  const [otherLastReadAt, setOtherLastReadAt] = useState<Date | null>(null);
  const sentReadIdsRef = useRef<Set<string>>(new Set());

  const title = useMemo(() => {
    const other = participants.find((p) => p.id !== meUserId);
    return other?.name || other?.email || "Chat";
  }, [participants, meUserId]);

  const otherUser = useMemo(() => participants.find((p) => p.id !== meUserId) ?? null, [participants, meUserId]);
  const canViewProfile = !!otherUser && !isAi(otherUser);
  const otherUserOnline = useMemo(() => {
    if (!otherUser) return false;
    if (isAi(otherUser)) return true;
    return onlineUserIds.has(otherUser.id);
  }, [otherUser, onlineUserIds]);

  useEffect(() => {
    if (!otherUser || isAi(otherUser)) {
      setOtherLastReadAt(null);
      return;
    }
    const iso = lastReadAtByUserId?.[otherUser.id] ?? "";
    if (!iso) {
      setOtherLastReadAt(null);
      return;
    }
    const d = new Date(iso);
    setOtherLastReadAt(Number.isFinite(d.getTime()) ? d : null);
  }, [otherUser, lastReadAtByUserId]);

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
        if (evt.readAt) {
          const d = new Date(evt.readAt);
          if (Number.isFinite(d.getTime())) setOtherLastReadAt(d);
        } else {
          setOtherLastReadAt(new Date());
        }
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

  function formatReadTime(d: Date) {
    try {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  function formatMessageTime(iso: string) {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    try {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch {
      return "";
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-chat-bg/40">
      <div className="border-b border-chat-border bg-chat-surface px-6 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-chat-lg border border-chat-border bg-chat-surface text-chat-text/80 hover:bg-chat-bg md:hidden"
              onClick={openSidebar}
              aria-label="Open sidebar"
            >
              <IconMenu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="truncate text-[18px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
                {title}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {canViewProfile ? (
              <Link
                href={`/users/${encodeURIComponent(otherUser.id)}`}
                className="rounded-chat-lg border border-chat-border bg-chat-surface px-3 py-2 text-xs font-medium text-chat-text/90 hover:bg-chat-bg"
              >
                View profile
              </Link>
            ) : null}
            <div className="flex items-center gap-2 rounded-full border border-chat-border bg-chat-surface px-3 py-2 text-xs text-chat-muted">
              <span
                className={[
                  "h-2 w-2 rounded-full",
                  otherUserOnline ? "bg-chat-primary" : "bg-chat-border"
                ].join(" ")}
              />
              <span className="whitespace-nowrap">
                {otherUserOnline ? "Online" : "Offline"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div
        className="flex min-h-0 flex-1 flex-col overflow-auto px-6 py-6"
        onClick={() => {
          setSelectedMessageId(null);
          closeMessageMenu();
        }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="max-w-sm rounded-chat-xl border border-chat-border bg-chat-surface px-5 py-4 text-center shadow-chat-card">
              <div className="text-sm font-semibold text-chat-text">No messages yet</div>
              <div className="mt-1 text-sm text-chat-muted">Send a message to start the conversation.</div>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            {messages.map((m, idx) => {
              const mine = m.senderId === meUserId;
              const createdAtMs = new Date(m.createdAt).getTime();
              const isRead =
                mine &&
                !!otherUser &&
                !!otherLastReadAt &&
                Number.isFinite(createdAtMs) &&
                createdAtMs <= otherLastReadAt.getTime();
              const isPersisted = !m.id.startsWith("temp:");
              const isSelected = selectedMessageId === m.id;
              const reactions = m.reactions ?? [];
              const myReaction = myReactionByMessageId[m.id] ?? null;
              const timeLabel = formatMessageTime(m.createdAt);

              const prev = idx > 0 ? messages[idx - 1] : null;
              const prevDayStart = prev ? startOfLocalDayMs(new Date(prev.createdAt)) : null;
              const dayStart = startOfLocalDayMs(new Date(m.createdAt));
              const showDateSeparator = idx === 0 || prevDayStart !== dayStart;
              const separator = showDateSeparator ? dateSeparatorLabel(m.createdAt) : "";
              return (
                <Fragment key={m.id}>
                  {showDateSeparator && separator ? (
                    <div className="flex justify-center py-2">
                      <div className="rounded-full border border-chat-border bg-chat-surface px-3 py-1 text-[12px] font-medium text-chat-muted shadow-sm">
                        {separator}
                      </div>
                    </div>
                  ) : null}

                  <div className={mine ? "flex justify-end" : "flex justify-start"}>
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
                              "hidden md:inline-flex absolute top-1 z-10 h-7 w-7 items-center justify-center rounded-full border border-chat-border bg-chat-surface text-xs text-chat-text/70 shadow-sm",
                              "opacity-0 transition-opacity group-hover:opacity-100",
                              // Place on inner top corner
                              mine ? "left-1" : "right-1"
                            ].join(" ")}
                          >
                            <IconChevronDown className="h-4 w-4" />
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
                            "rounded-chat-lg px-3.5 py-2.5 text-sm leading-snug",
                            isPersisted && isSelected ? "ring-2 ring-chat-ring/25" : "",
                            mine
                              ? "bg-chat-primary text-chat-primary-foreground"
                              : isAi(m.sender)
                                ? "border border-chat-border bg-chat-surface2 text-chat-text"
                                : "border border-chat-border bg-chat-surface text-chat-text"
                          ].join(" ")}
                        >
                          <div className="whitespace-pre-wrap break-words">{m.content}</div>

                          <div
                            className={[
                              "mt-1.5 flex items-center justify-end gap-1.5 text-[11px]",
                              mine ? "text-chat-primary-foreground/80" : "text-chat-muted"
                            ].join(" ")}
                          >
                            {mine ? (
                              <span className="inline-flex items-center gap-1.5">
                                <span
                                  className="inline-flex items-center gap-0.5"
                                  aria-label={isRead ? "Read" : "Sent"}
                                >
                                  <span>✓</span>
                                  {isRead ? <span>✓</span> : null}
                                </span>
                                <span className="opacity-90">
                                  {isRead && otherLastReadAt ? formatReadTime(otherLastReadAt) : timeLabel}
                                </span>
                              </span>
                            ) : (
                              <span>{timeLabel}</span>
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
                              "absolute -bottom-3 z-10 inline-flex items-center gap-1 rounded-full border border-chat-border bg-chat-surface px-2 text-[11px] text-chat-text shadow-sm",
                              // Place on inner bottom corner (matches WhatsApp screenshot)
                              mine ? "left-2" : "right-2"
                            ].join(" ")}
                            aria-label="Message reactions"
                          >
                            {reactions.slice(0, 3).map((r) => (
                              <span
                                key={`${m.id}:chip:${r.emoji}`}
                                className={myReaction === r.emoji ? "text-chat-text" : "text-chat-text/80"}
                              >
                                {r.emoji}
                              </span>
                            ))}
                            <span className="text-chat-muted">
                              {reactions.reduce((sum, r) => sum + (r.count || 0), 0)}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </Fragment>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-chat-border bg-chat-surface px-6 py-5">
        {error ? (
          <div className="mb-3 rounded-chat-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">{error}</div>
              <button
                type="button"
                onClick={() => setReconnectKey((k) => k + 1)}
                className="shrink-0 rounded-chat-lg border border-red-200 bg-white px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-50"
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}

        {typingLabel ? (
          <div className="mb-2 text-xs text-chat-muted">{typingLabel}</div>
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
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-chat-lg border border-chat-border bg-chat-surface text-lg text-chat-text/80 hover:bg-chat-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              <IconSmile className="h-5 w-5" />
            </button>

            {emojiOpen ? (
              <div className="absolute bottom-12 left-0 z-10 w-56 rounded-chat-xl border border-chat-border bg-chat-surface p-2 shadow-chat-card">
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
                      className="inline-flex h-9 w-9 items-center justify-center rounded-chat-lg hover:bg-chat-bg"
                      aria-label={`Insert ${emoji}`}
                    >
                      <span className="text-lg leading-none">{emoji}</span>
                    </button>
                  ))}
                </div>
                <div className="mt-2 text-[11px] text-chat-muted">Click to insert into the message.</div>
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
            className="h-11 flex-1 resize-none overflow-hidden rounded-chat-lg border border-chat-border bg-chat-surface px-4 py-3 text-sm text-chat-text outline-none placeholder:text-chat-muted/70 focus:border-chat-primary focus:ring-2 focus:ring-chat-ring/20"
          />
          <button
            type="button"
            onClick={send}
            disabled={!canType || !content.trim()}
            aria-label="Send message"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-chat-lg bg-chat-primary text-chat-primary-foreground hover:brightness-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? (
              <span
                className="h-5 w-5 animate-spin rounded-full border-2 border-chat-primary-foreground/70 border-t-transparent"
                aria-hidden="true"
              />
            ) : (
              <IconSend className="h-5 w-5" />
            )}
          </button>
        </div>
        <div className="mt-2 text-xs text-chat-muted">
          {connected ? (joined ? "Enter to send • Shift+Enter for newline" : "Joining session…") : "Offline — messages are disabled."}
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
              "w-[260px] rounded-chat-xl border border-chat-border bg-chat-surface shadow-chat-card",
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
                  className="inline-flex h-9 w-9 items-center justify-center rounded-chat-lg text-base hover:bg-chat-bg"
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              ))}
            </div>

            <div className="h-px bg-chat-border" />

            <div className="p-1.5">
              <button
                type="button"
                onClick={() => {
                  void copyMessage(messageMenu.content);
                  setSelectedMessageId(null);
                  closeMessageMenu();
                  focusComposer();
                }}
                className="flex w-full items-center gap-3 rounded-chat-lg px-3 py-2.5 text-sm text-chat-text hover:bg-chat-bg"
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-chat-lg border border-chat-border bg-chat-surface text-chat-text/70">
                  <IconCopy className="h-4 w-4" />
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
                  className="mt-1 flex w-full items-center gap-3 rounded-chat-lg px-3 py-2.5 text-sm text-red-700 hover:bg-red-50"
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-chat-lg border border-red-200 bg-white text-red-700">
                    <IconTrash className="h-4 w-4" />
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


