"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { Sidebar } from "./Sidebar";

type ChatShellContextValue = {
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  unreadByUserId: Record<string, number>;
  incrementUnread: (userId: string) => void;
  clearUnread: (userId: string) => void;
  onlineUserIds: Set<string>;
  setOnlineUsers: (userIds: string[]) => void;
  markUserOnline: (userId: string) => void;
  markUserOffline: (userId: string) => void;
};

const ChatShellContext = createContext<ChatShellContextValue | null>(null);

export function useChatShell() {
  const ctx = useContext(ChatShellContext);
  if (!ctx) throw new Error("useChatShell must be used within <ChatShell />");
  return ctx;
}

export function ChatShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unreadByUserId, setUnreadByUserId] = useState<Record<string, number>>({});
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [meUserId, setMeUserId] = useState<string | null>(null);

  const unreadStorageKey = useMemo(() => (meUserId ? `chat:unreadByUserId:${meUserId}` : null), [meUserId]);

  useEffect(() => {
    let cancelled = false;
    async function loadMe() {
      try {
        const res = await fetch("/api/me", { credentials: "include" });
        const json = (await res.json().catch(() => null)) as { user?: { id?: string } } | null;
        const id = typeof json?.user?.id === "string" ? json.user.id : null;
        if (!cancelled) setMeUserId(id);
      } catch {
        // ignore
      }
    }
    void loadMe();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!unreadStorageKey) return;
    try {
      const raw = window.localStorage.getItem(unreadStorageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return;
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof k !== "string" || !k) continue;
        const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
        if (!Number.isFinite(n) || n <= 0) continue;
        next[k] = Math.min(4, Math.max(1, Math.floor(n)));
      }
      // Merge (don’t overwrite) to avoid race conditions where new unread arrives
      // before the persisted state finishes loading.
      setUnreadByUserId((prev) => {
        if (!prev || Object.keys(prev).length === 0) return next;
        const merged: Record<string, number> = { ...prev };
        for (const [k, v] of Object.entries(next)) {
          merged[k] = Math.min(4, Math.max(merged[k] ?? 0, v));
        }
        return merged;
      });
    } catch {
      // ignore
    }
  }, [unreadStorageKey]);

  useEffect(() => {
    if (!meUserId) return;
    let cancelled = false;
    async function loadServerUnread() {
      try {
        const res = await fetch("/api/chat/unread-counts", { credentials: "include" });
        const json = (await res.json().catch(() => null)) as
          | { unread?: Array<{ userId: string; count: number }> }
          | null;
        const rows = Array.isArray(json?.unread) ? json!.unread! : [];
        if (cancelled) return;
        setUnreadByUserId((prev) => {
          const next = { ...prev };
          for (const r of rows) {
            const id = typeof r?.userId === "string" ? r.userId : "";
            const c = typeof r?.count === "number" ? r.count : Number.NaN;
            if (!id) continue;
            if (!Number.isFinite(c) || c <= 0) continue;
            next[id] = Math.min(4, Math.max(next[id] ?? 0, Math.floor(c)));
          }
          return next;
        });
      } catch {
        // ignore
      }
    }
    void loadServerUnread();
    return () => {
      cancelled = true;
    };
  }, [meUserId]);

  useEffect(() => {
    if (!unreadStorageKey) return;
    try {
      window.localStorage.setItem(unreadStorageKey, JSON.stringify(unreadByUserId));
    } catch {
      // ignore
    }
  }, [unreadStorageKey, unreadByUserId]);

  const incrementUnread = useCallback((userId: string) => {
    if (!userId) return;
    setUnreadByUserId((prev) => ({
      ...prev,
      // Cap at 4; UI will display "4+" when value is 4.
      [userId]: Math.min(4, (prev[userId] ?? 0) + 1)
    }));
  }, []);

  const clearUnread = useCallback((userId: string) => {
    if (!userId) return;
    setUnreadByUserId((prev) => {
      if (!prev[userId]) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  const setOnlineUsers = useCallback((userIds: string[]) => {
    setOnlineUserIds(new Set((userIds ?? []).filter(Boolean)));
  }, []);

  const markUserOnline = useCallback((userId: string) => {
    if (!userId) return;
    setOnlineUserIds((prev) => {
      if (prev.has(userId)) return prev;
      const next = new Set(prev);
      next.add(userId);
      return next;
    });
  }, []);

  const markUserOffline = useCallback((userId: string) => {
    if (!userId) return;
    setOnlineUserIds((prev) => {
      if (!prev.has(userId)) return prev;
      const next = new Set(prev);
      next.delete(userId);
      return next;
    });
  }, []);

  const value = useMemo<ChatShellContextValue>(
    () => ({
      openSidebar: () => setMobileOpen(true),
      closeSidebar: () => setMobileOpen(false),
      toggleSidebar: () => setMobileOpen((v) => !v),
      unreadByUserId,
      incrementUnread,
      clearUnread,
      onlineUserIds,
      setOnlineUsers,
      markUserOnline,
      markUserOffline
    }),
    [unreadByUserId, incrementUnread, clearUnread, onlineUserIds, setOnlineUsers, markUserOnline, markUserOffline]
  );

  return (
    <ChatShellContext.Provider value={value}>
      {/* Mobile backdrop */}
      {mobileOpen ? (
        <button
          type="button"
          aria-label="Close sidebar"
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px] md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}

      <div className="flex h-full min-h-0 bg-chat-bg p-4 md:p-6">
        <div className="mx-auto flex w-full max-w-6xl min-h-0 overflow-hidden rounded-chat-xl bg-chat-surface shadow-chat-card ring-1 ring-chat-border/80">
          <div
            className={[
              "fixed inset-y-0 left-0 z-40 w-[92vw] max-w-[460px] transform bg-chat-surface transition-transform md:static md:z-auto md:w-[460px] md:max-w-none md:translate-x-0",
              mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
            ].join(" ")}
          >
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-chat-bg/40">{children}</div>
        </div>
      </div>
    </ChatShellContext.Provider>
  );
}


