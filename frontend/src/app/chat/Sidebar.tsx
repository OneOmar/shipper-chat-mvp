"use client";

import type { Socket } from "socket.io-client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { LogoutButton } from "./LogoutButton";
import { useChatShell } from "./ChatShell";
import { useUnreadIndicator } from "./useUnreadIndicator";
import { createClientSocket } from "@/lib/socket-client";
import { IconFilter, IconHome, IconMessage, IconSearch, IconStar, IconUser } from "@/app/_components/icons";

type User = { id: string; name: string | null; email: string; image: string | null };
type OnlineUser = { userId: string; email: string };

function Avatar({ user }: { user: User }) {
  const label = user.name?.trim() || user.email;
  const src = user.image || "/avatar-placeholder.svg";
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={label}
      className="h-full w-full rounded-full object-cover"
      onError={(e) => {
        const el = e.currentTarget;
        if (el.src.endsWith("/avatar-placeholder.svg")) return;
        el.src = "/avatar-placeholder.svg";
      }}
    />
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { unreadByUserId, incrementUnread, clearUnread } = useChatShell();

  const activeUserId = searchParams?.get("user") ?? "";

  const [users, setUsers] = useState<User[]>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [messageSearch, setMessageSearch] = useState("");

  const isChatRoute = useMemo(() => (pathname ?? "").startsWith("/chat"), [pathname]);

  const { registerChatSession } = useUnreadIndicator({
    socket,
    activeUserId,
    incrementUnread,
    clearUnread
  });

  useEffect(() => {
    if (!isChatRoute) return;
    let mounted = true;

    async function load() {
      setLoading(true);
      setLoadError(null);
      try {
        const [usersRes, onlineRes] = await Promise.all([
          fetch("/api/users", { credentials: "include" }),
          fetch("/api/online-users", { credentials: "include" })
        ]);

        if (!usersRes.ok) throw new Error("Failed to load users");
        if (!onlineRes.ok) throw new Error("Failed to load online users");

        const usersJson = (await usersRes.json()) as { users: User[] };
        const onlineJson = (await onlineRes.json()) as { onlineUsers: OnlineUser[] };

        if (!mounted) return;
        setUsers(usersJson.users ?? []);
        setOnline(new Set((onlineJson.onlineUsers ?? []).map((u) => u.userId)));
      } catch {
        if (!mounted) return;
        setLoadError("Couldn't load users. Please retry.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [isChatRoute]);

  useEffect(() => {
    if (!isChatRoute) return;
    let s: Socket | null = null;
    let cancelled = false;

    async function connect() {
      // Ensure the Socket.IO server is initialized.
      await fetch("/api/socket", { credentials: "include" });
      if (cancelled) return;

      s = createClientSocket();

      s.on("user_online", (evt: { userId: string }) => {
        setOnline((prev) => {
          const next = new Set(prev);
          next.add(evt.userId);
          return next;
        });
      });

      s.on("user_offline", (evt: { userId: string }) => {
        setOnline((prev) => {
          const next = new Set(prev);
          next.delete(evt.userId);
          return next;
        });
      });

      setSocket(s);
    }

    connect();

    return () => {
      cancelled = true;
      if (s) s.disconnect();
      setSocket(null);
    };
  }, [isChatRoute]);

  async function openChat(userId: string) {
    setPendingUserId(userId);
    try {
      const res = await fetch("/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ userId })
      });

      const data = (await res.json().catch(() => null)) as { sessionId?: string; error?: string } | null;
      if (!res.ok || !data?.sessionId) return;

      registerChatSession(userId, data.sessionId);
      clearUnread(userId);
      router.push(`/chat/${data.sessionId}?user=${encodeURIComponent(userId)}`);
      onNavigate?.();
    } finally {
      setPendingUserId(null);
    }
  }

  async function openAiChat() {
    setPendingUserId("ai");
    try {
      const res = await fetch("/api/chat/ai-session", {
        method: "POST",
        credentials: "include"
      });
      const data = (await res.json().catch(() => null)) as { sessionId?: string } | null;
      if (!res.ok || !data?.sessionId) return;
      router.push(`/chat/${data.sessionId}?user=ai`);
      onNavigate?.();
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <aside className="flex h-full min-h-0 w-full">
      {/* Icon rail (matches Figma left strip) */}
      <div className="flex w-[76px] shrink-0 flex-col items-center border-r border-chat-border bg-chat-surface px-3 py-5">
        <div className="relative h-11 w-11 overflow-hidden rounded-full">
          <Image src="/logo.png" alt="Shipper Chat" width={44} height={44} className="h-11 w-11" priority />
        </div>

        <div className="mt-6 flex flex-col items-center gap-2">
          <Link
            href="/"
            onClick={() => onNavigate?.()}
            className={[
              "inline-flex h-11 w-11 items-center justify-center rounded-chat-lg border transition-colors",
              pathname === "/" ? "border-chat-primary bg-chat-bg text-chat-primary" : "border-transparent text-chat-text/70 hover:bg-chat-bg"
            ].join(" ")}
            aria-label="Home"
          >
            <IconHome className="h-5 w-5" />
          </Link>

          <Link
            href="/chat"
            onClick={() => onNavigate?.()}
            className={[
              "inline-flex h-11 w-11 items-center justify-center rounded-chat-lg border transition-colors",
              (pathname ?? "").startsWith("/chat")
                ? "border-chat-primary bg-chat-bg text-chat-primary"
                : "border-transparent text-chat-text/70 hover:bg-chat-bg"
            ].join(" ")}
            aria-label="Chat"
          >
            <IconMessage className="h-5 w-5" />
          </Link>

          <button
            type="button"
            onClick={openAiChat}
            disabled={pendingUserId !== null}
            className={[
              "inline-flex h-11 w-11 items-center justify-center rounded-chat-lg border transition-colors",
              activeUserId === "ai"
                ? "border-chat-primary bg-chat-bg text-chat-primary"
                : "border-transparent text-chat-text/70 hover:bg-chat-bg disabled:opacity-60"
            ].join(" ")}
            aria-label="Chat with AI"
          >
            <IconStar className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-auto flex flex-col items-center gap-2">
          <Link
            href="/profile"
            onClick={() => onNavigate?.()}
            className="inline-flex h-11 w-11 items-center justify-center rounded-chat-lg border border-chat-border bg-chat-surface text-chat-text/80 hover:bg-chat-bg"
            aria-label="Profile"
          >
            <IconUser className="h-5 w-5" />
          </Link>
          <LogoutButton iconOnly className="h-11 w-11 px-0" />
        </div>
      </div>

      {/* Main list */}
      <div className="flex min-w-0 flex-1 flex-col bg-chat-surface">
        <div className="border-b border-chat-border px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
                Message
              </div>
              <div className="mt-1 text-xs text-chat-muted">{socket ? "Live" : "Offline"}</div>
            </div>

            {pendingUserId ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-chat-border border-t-chat-primary" aria-label="Loading" />
            ) : null}
          </div>

          {/* Search in message (visual-only; no filtering behavior) */}
          <div className="mt-4 flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-chat-muted" />
              <input
                value={messageSearch}
                onChange={(e) => setMessageSearch(e.target.value)}
                placeholder="Search in message"
                aria-label="Search in message"
                className="h-11 w-full rounded-chat-lg border border-chat-border bg-chat-surface px-10 pr-3 text-sm text-chat-text placeholder:text-chat-muted/70 outline-none focus:border-chat-primary focus:ring-2 focus:ring-chat-ring/20"
              />
            </div>
            <button
              type="button"
              aria-label="Filter"
              className="inline-flex h-11 w-11 items-center justify-center rounded-chat-lg border border-chat-border bg-chat-surface text-chat-muted hover:bg-chat-bg"
            >
              <IconFilter className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-3">
          {/* AI entry */}
          <div className="mb-2">
            <button
              type="button"
              onClick={openAiChat}
              disabled={pendingUserId !== null}
              className={[
                "flex w-full items-center gap-3 rounded-chat-lg border px-3.5 py-3 text-left transition-colors",
                activeUserId === "ai"
                  ? "border-chat-primary bg-chat-bg"
                  : "border-transparent hover:border-chat-border hover:bg-chat-bg/60"
              ].join(" ")}
            >
              <div className="relative">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-chat-primary text-xs font-semibold text-chat-primary-foreground">
                  AI
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-chat-primary ring-2 ring-chat-surface" aria-label="ai" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-chat-text">Chat with AI</div>
                <div className="truncate text-xs text-chat-muted">Ask anything</div>
              </div>
              {pendingUserId === "ai" ? (
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-chat-border border-t-chat-primary" />
              ) : null}
            </button>
          </div>

          {loadError ? (
            <div className="rounded-chat-lg border border-chat-border bg-chat-bg/50 px-3 py-3 text-sm text-chat-muted">
              <div>{loadError}</div>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="mt-2 inline-flex rounded-chat-lg border border-chat-border bg-chat-surface px-3 py-2 text-xs font-medium text-chat-text/90 hover:bg-chat-bg"
              >
                Retry
              </button>
            </div>
          ) : loading ? (
            <div className="px-3 py-2 text-sm text-chat-muted">Loading…</div>
          ) : users.length === 0 ? (
            <div className="px-3 py-2 text-sm text-chat-muted">No users found.</div>
          ) : (
            <ul className="space-y-1.5">
              {users.map((u) => {
                const isOnline = online.has(u.id);
                const isActive = activeUserId === u.id;
                const unread = unreadByUserId[u.id] ?? 0;
                const showUnread = !isActive && unread > 0;
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => openChat(u.id)}
                      disabled={pendingUserId !== null}
                      className={[
                        "flex w-full items-center gap-3 rounded-chat-lg border px-3.5 py-3 text-left transition-colors",
                        isActive
                          ? "border-chat-primary bg-chat-bg"
                          : showUnread
                            ? "border-chat-border bg-chat-bg/60 hover:bg-chat-bg"
                            : "border-transparent hover:border-chat-border hover:bg-chat-bg/60"
                      ].join(" ")}
                    >
                      <div className="relative">
                        <div className="h-11 w-11">
                          <Avatar user={u} />
                        </div>
                        <span
                          className={[
                            "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-chat-surface",
                            isOnline ? "bg-chat-primary" : "bg-chat-border"
                          ].join(" ")}
                          aria-label={isOnline ? "online" : "offline"}
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-chat-text">{u.name || u.email}</div>
                        <div className="truncate text-xs text-chat-muted">{u.email}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {showUnread ? (
                          <span
                            className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-chat-primary px-2 text-[11px] font-semibold text-chat-primary-foreground"
                            aria-label={`${unread} unread messages`}
                          >
                            {unread > 99 ? "99+" : unread}
                          </span>
                        ) : null}
                        {pendingUserId === u.id ? (
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-chat-border border-t-chat-primary" />
                        ) : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}


