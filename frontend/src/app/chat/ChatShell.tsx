"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { Sidebar } from "./Sidebar";

type ChatShellContextValue = {
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  unreadByUserId: Record<string, number>;
  incrementUnread: (userId: string) => void;
  clearUnread: (userId: string) => void;
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

  const incrementUnread = useCallback((userId: string) => {
    if (!userId) return;
    setUnreadByUserId((prev) => ({
      ...prev,
      [userId]: Math.min(99, (prev[userId] ?? 0) + 1)
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

  const value = useMemo<ChatShellContextValue>(
    () => ({
      openSidebar: () => setMobileOpen(true),
      closeSidebar: () => setMobileOpen(false),
      toggleSidebar: () => setMobileOpen((v) => !v),
      unreadByUserId,
      incrementUnread,
      clearUnread
    }),
    [unreadByUserId, incrementUnread, clearUnread]
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
              "fixed inset-y-0 left-0 z-40 w-[340px] transform bg-chat-surface transition-transform md:static md:z-auto md:w-[340px] md:translate-x-0",
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


