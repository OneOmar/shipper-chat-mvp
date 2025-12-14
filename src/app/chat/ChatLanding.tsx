"use client";

import { useChatShell } from "./ChatShell";

export function ChatLanding() {
  const { openSidebar } = useChatShell();

  return (
    <div className="p-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Select a chat</h1>
              <p className="mt-2 text-sm text-zinc-400">
                Choose a user (or AI) from the sidebar to start.
              </p>
            </div>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900 md:hidden"
              onClick={openSidebar}
            >
              Users
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


