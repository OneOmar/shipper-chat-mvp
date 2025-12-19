import Link from "next/link";

import { ProfileClient } from "./ProfileClient";

export const runtime = "nodejs";

export default function ProfilePage() {
  return (
    <div className="chat-theme min-h-screen bg-chat-bg text-chat-text">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">Profile</div>
            <div className="text-sm text-chat-muted">Edit your public profile details.</div>
          </div>
          <Link
            href="/chat"
            className="rounded-chat-lg border border-chat-border bg-chat-surface px-3 py-2 text-xs font-medium text-chat-text/90 hover:bg-chat-bg"
          >
            Back to chat
          </Link>
        </div>

        <div className="rounded-chat-xl border border-chat-border bg-chat-surface p-6 shadow-chat-card">
          <ProfileClient />
        </div>
      </div>
    </div>
  );
}

