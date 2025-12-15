"use client";

import { io, type Socket } from "socket.io-client";
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { LogoutButton } from "./LogoutButton";
import { useChatShell } from "./ChatShell";
import { useUnreadIndicator } from "./useUnreadIndicator";

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
      className="h-9 w-9 rounded-full object-cover"
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

      s = io({
        path: "/socket.io",
        withCredentials: true
      });

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
    <aside className="flex h-full w-80 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Users</div>
          <div className="text-xs text-zinc-500">{socket ? "Live" : "Offline"}</div>
        </div>
        <LogoutButton />
      </div>

      <div className="flex-1 overflow-auto p-2">
        <div className="mb-2">
          <button
            type="button"
            onClick={openAiChat}
            disabled={pendingUserId !== null}
            className={[
              "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
              activeUserId === "ai"
                ? "bg-zinc-900 text-zinc-100 border border-zinc-700"
                : "hover:bg-zinc-900/60 text-zinc-200 border border-transparent"
            ].join(" ")}
          >
            <div className="relative">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-xs font-semibold text-white">
                AI
              </div>
              <span
                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-indigo-400 ring-2 ring-zinc-950"
                aria-label="ai"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">Chat with AI</div>
              <div className="truncate text-xs text-zinc-500">Ask anything</div>
            </div>
            {pendingUserId === "ai" ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
            ) : null}
          </button>
        </div>

        {loadError ? (
          <div className="px-3 py-2 text-sm text-zinc-400">
            <div>{loadError}</div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 inline-flex rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-900"
            >
              Retry
            </button>
          </div>
        ) : loading ? (
          <div className="px-3 py-2 text-sm text-zinc-500">Loading…</div>
        ) : users.length === 0 ? (
          <div className="px-3 py-2 text-sm text-zinc-500">No users found.</div>
        ) : (
          <ul className="space-y-1">
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
                      "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
                      isActive
                        ? "bg-zinc-900 text-zinc-100 border border-zinc-700"
                        : showUnread
                          ? "bg-emerald-950/30 text-zinc-100 border border-emerald-900/60 hover:bg-emerald-950/40"
                          : "hover:bg-zinc-900/60 text-zinc-200 border border-transparent"
                    ].join(" ")}
                  >
                    <div className="relative">
                      <Avatar user={u} />
                      <span
                        className={[
                          "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-zinc-950",
                          isOnline ? "bg-emerald-500" : "bg-zinc-600"
                        ].join(" ")}
                        aria-label={isOnline ? "online" : "offline"}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{u.name || u.email}</div>
                      <div className="truncate text-xs text-zinc-500">{u.email}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      {showUnread ? (
                        <span
                          className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-semibold text-zinc-950"
                          aria-label={`${unread} unread messages`}
                        >
                          {unread > 99 ? "99+" : unread}
                        </span>
                      ) : null}
                      {pendingUserId === u.id ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}


