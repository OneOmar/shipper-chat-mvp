"use client";

import type { Socket } from "socket.io-client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { LogoutButton } from "./LogoutButton";
import { useChatShell } from "./ChatShell";
import { useUnreadIndicator } from "./useUnreadIndicator";
import { createClientSocket } from "@/lib/socket-client";
import { IconEdit, IconFilter, IconHome, IconMessage, IconSearch, IconStar, IconUser } from "@/app/_components/icons";

type User = { id: string; name: string | null; email: string; image: string | null };
type OnlineUser = { userId: string; email: string };
type SearchResult = {
  messageId: string;
  sessionId: string;
  createdAt: string;
  content: string;
  peerUserId: string;
  peer: { id: string; name: string | null; email: string; image: string | null } | null;
};

function UnreadPill({ count }: { count: number }) {
  const label = count >= 4 ? "4+" : String(count);
  return (
    <div
      className="flex h-12 w-14 items-center justify-center rounded-[14px] bg-chat-primary text-chat-primary-foreground"
      aria-label={`${label} unread messages`}
    >
      <div className="relative">
        <IconMessage className="h-4 w-4" />
        <span className="absolute -right-3 -top-2 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-chat-primary-foreground px-1 text-[10px] font-semibold leading-none text-chat-primary">
          {label}
        </span>
      </div>
    </div>
  );
}

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
  const { unreadByUserId, incrementUnread, clearUnread, onlineUserIds, setOnlineUsers, markUserOnline, markUserOffline } =
    useChatShell();

  const activeUserId = searchParams?.get("user") ?? "";

  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [socketOnline, setSocketOnline] = useState(false);
  const [messageSearch, setMessageSearch] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const searchReqIdRef = useRef(0);
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const [newMessageQuery, setNewMessageQuery] = useState("");
  const newMessageButtonRef = useRef<HTMLButtonElement | null>(null);
  const newMessagePopoverRef = useRef<HTMLDivElement | null>(null);

  const isChatRoute = useMemo(() => (pathname ?? "").startsWith("/chat"), [pathname]);

  const { registerChatSession } = useUnreadIndicator({
    socket,
    activeUserId,
    incrementUnread,
    clearUnread
  });

  const searchQuery = messageSearch.trim();
  const searchActive = searchQuery.length >= 2;

  useEffect(() => {
    // Close the New Message popover when navigating to a chat (from anywhere).
    setNewMessageOpen(false);
    setNewMessageQuery("");
  }, [activeUserId]);

  useEffect(() => {
    if (!newMessageOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNewMessageOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newMessageOpen]);

  useEffect(() => {
    if (!newMessageOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (newMessagePopoverRef.current?.contains(target)) return;
      if (newMessageButtonRef.current?.contains(target)) return;
      setNewMessageOpen(false);
      setNewMessageQuery("");
    };
    // Capture phase so it still works even if the chat pane stops propagation.
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [newMessageOpen]);

  useEffect(() => {
    if (!isChatRoute) return;
    if (!searchActive) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    const reqId = ++searchReqIdRef.current;
    setSearchLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/chat/search?q=${encodeURIComponent(searchQuery)}&limit=20`, {
          credentials: "include"
        });
        const json = (await res.json().catch(() => null)) as { results?: SearchResult[] } | null;
        if (searchReqIdRef.current !== reqId) return;
        setSearchResults(Array.isArray(json?.results) ? json!.results! : []);
      } catch {
        if (searchReqIdRef.current !== reqId) return;
        setSearchResults([]);
      } finally {
        if (searchReqIdRef.current === reqId) setSearchLoading(false);
      }
    }, 200);

    return () => window.clearTimeout(t);
  }, [isChatRoute, searchActive, searchQuery]);

  const filteredUsers = useMemo(() => {
    if (!searchActive) return users;
    return users;
  }, [users, searchActive]);

  const newMessageUsers = useMemo(() => {
    const q = newMessageQuery.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const name = (u.name ?? "").toLowerCase();
      const email = (u.email ?? "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [users, newMessageQuery]);

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
        setOnlineUsers((onlineJson.onlineUsers ?? []).map((u) => u.userId));
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
  }, [isChatRoute, setOnlineUsers]);

  useEffect(() => {
    if (!isChatRoute) return;
    let s: Socket | null = null;
    let cancelled = false;

    async function connect() {
      // Ensure the Socket.IO server is initialized.
      await fetch("/api/socket", { credentials: "include" });
      if (cancelled) return;

      s = createClientSocket();

      setSocketOnline(s.connected);
      s.on("connect", () => setSocketOnline(true));
      s.on("disconnect", () => setSocketOnline(false));

      s.on("user_online", (evt: { userId: string }) => {
        markUserOnline(evt.userId);
      });

      s.on("user_offline", (evt: { userId: string }) => {
        markUserOffline(evt.userId);
      });

      setSocket(s);
    }

    connect();

    return () => {
      cancelled = true;
      if (s) s.disconnect();
      setSocket(null);
      setSocketOnline(false);
    };
  }, [isChatRoute, markUserOnline, markUserOffline]);

  async function openChat(userId: string) {
    setNewMessageOpen(false);
    setNewMessageQuery("");
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
    setNewMessageOpen(false);
    setNewMessageQuery("");
    setPendingUserId("ai");
    try {
      const res = await fetch("/api/chat/ai-session", {
        method: "POST",
        credentials: "include"
      });
      const data = (await res.json().catch(() => null)) as { sessionId?: string } | null;
      if (!res.ok || !data?.sessionId) return;
      registerChatSession("ai", data.sessionId);
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
              <div className="text-[20px] font-semibold leading-tight tracking-[-0.02em] text-chat-text">
                All Message
              </div>
              {/* Status hidden to match reference */}
            </div>

            <div className="relative flex items-center gap-2">
              <button
                type="button"
                ref={newMessageButtonRef}
                onClick={() => {
                  setNewMessageOpen((v) => !v);
                  setNewMessageQuery("");
                }}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-chat-primary px-4 text-sm font-semibold text-chat-primary-foreground shadow-sm hover:brightness-[0.98]"
                aria-haspopup="dialog"
                aria-expanded={newMessageOpen}
              >
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-chat-primary-foreground/15">
                  <IconEdit className="h-4 w-4" />
                </span>
                New Message
              </button>

              {pendingUserId ? (
                <div
                  className="h-4 w-4 animate-spin rounded-full border-2 border-chat-border border-t-chat-primary"
                  aria-label="Loading"
                />
              ) : null}

              {newMessageOpen ? (
                <>
                  <div
                    ref={newMessagePopoverRef}
                    className="absolute right-0 top-12 z-50 w-[320px] rounded-chat-xl border border-chat-border bg-chat-surface p-3 shadow-chat-card ring-1 ring-chat-border/60"
                  >
                    <div className="px-1 pb-2">
                      <div className="text-sm font-semibold text-chat-text">New Message</div>
                    </div>
                    <div className="relative px-1">
                      <IconSearch className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-chat-muted" />
                      <input
                        value={newMessageQuery}
                        onChange={(e) => setNewMessageQuery(e.target.value)}
                        autoFocus
                        placeholder="Search name or email"
                        className="h-11 w-full rounded-chat-lg border border-chat-border bg-chat-surface px-10 pr-3 text-sm text-chat-text placeholder:text-chat-muted/70 outline-none focus:border-chat-primary focus:ring-2 focus:ring-chat-ring/20"
                      />
                    </div>
                    <div className="mt-2 max-h-[360px] overflow-auto px-1">
                      {newMessageUsers.length === 0 ? (
                        <div className="px-2 py-3 text-sm text-chat-muted">No users found.</div>
                      ) : (
                        <ul className="space-y-1">
                          {newMessageUsers.map((u) => (
                            <li key={`new:${u.id}`}>
                              <button
                                type="button"
                                onClick={() => {
                                  setNewMessageOpen(false);
                                  void openChat(u.id);
                                }}
                                className="flex w-full items-center gap-3 rounded-chat-lg px-2.5 py-2 text-left hover:bg-chat-bg"
                              >
                                <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full">
                                  <Avatar user={u} />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-sm font-semibold text-chat-text">{u.name || u.email}</div>
                                  <div className="truncate text-xs text-chat-muted">{u.email}</div>
                                </div>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
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
          {searchActive ? (
            <div className="mb-3">
              <div className="px-2 pb-2 text-xs font-medium text-chat-muted">Results</div>
              {searchLoading ? (
                <div className="px-2 py-2 text-sm text-chat-muted">Searching…</div>
              ) : searchResults.length === 0 ? (
                <div className="px-2 py-2 text-sm text-chat-muted">No results.</div>
              ) : (
                <ul className="space-y-1.5">
                  {searchResults.map((r) => {
                    const peerLabel = r.peer?.name?.trim() || r.peer?.email || (r.peerUserId === "ai" ? "Chat with AI" : "Unknown");
                    const snippet = (r.content || "").replace(/\s+/g, " ").trim();
                    const short = snippet.length > 90 ? `${snippet.slice(0, 90)}…` : snippet;
                    const when = (() => {
                      const d = new Date(r.createdAt);
                      if (!Number.isFinite(d.getTime())) return "";
                      try {
                        return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
                      } catch {
                        return "";
                      }
                    })();

                    return (
                      <li key={`${r.sessionId}:${r.messageId}`}>
                        <button
                          type="button"
                          onClick={() => {
                            // Make sure session mapping exists for unread logic.
                            registerChatSession(r.peerUserId || "ai", r.sessionId);
                            clearUnread(r.peerUserId);
                            router.push(
                              `/chat/${encodeURIComponent(r.sessionId)}?user=${encodeURIComponent(r.peerUserId || "ai")}&msg=${encodeURIComponent(r.messageId)}&q=${encodeURIComponent(searchQuery)}`
                            );
                            onNavigate?.();
                            setMessageSearch("");
                          }}
                          className="flex w-full items-start gap-3 rounded-chat-lg border border-chat-border bg-chat-surface px-3.5 py-3 text-left hover:bg-chat-bg"
                        >
                          <div className="relative mt-0.5 h-9 w-9 shrink-0 overflow-hidden rounded-full">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={r.peer?.image || "/avatar-placeholder.svg"}
                              alt={peerLabel}
                              className="h-9 w-9 rounded-full object-cover"
                              onError={(e) => {
                                const el = e.currentTarget;
                                if (el.src.endsWith("/avatar-placeholder.svg")) return;
                                el.src = "/avatar-placeholder.svg";
                              }}
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-3">
                              <div className="truncate text-sm font-semibold text-chat-text">{peerLabel}</div>
                              <div className="shrink-0 text-[11px] text-chat-muted">{when}</div>
                            </div>
                            <div className="mt-0.5 line-clamp-2 text-xs text-chat-muted">{short}</div>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : null}

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
              {activeUserId !== "ai" && (unreadByUserId["ai"] ?? 0) > 0 ? <UnreadPill count={unreadByUserId["ai"] ?? 0} /> : null}
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
              {filteredUsers.map((u) => {
                const isOnline = onlineUserIds.has(u.id);
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
                      {showUnread ? <UnreadPill count={unread} /> : null}
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
                      {pendingUserId === u.id ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-chat-border border-t-chat-primary" />
                      ) : null}
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


