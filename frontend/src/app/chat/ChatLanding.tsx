"use client";

import { useChatShell } from "./ChatShell";

export function ChatLanding() {
  const { openSidebar } = useChatShell();

  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6 py-10">
      <div className="w-full max-w-xl">
        <div className="rounded-chat-xl border border-chat-border bg-chat-surface px-6 py-6 shadow-chat-card">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">
                Select a chat
              </h1>
              <p className="mt-2 text-sm text-chat-muted">
                Choose a user (or AI) from the left panel to start.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-chat-lg border border-chat-border bg-chat-surface px-3 py-2 text-sm font-medium text-chat-text/90 hover:bg-chat-bg md:hidden"
              onClick={openSidebar}
            >
              Messages
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


