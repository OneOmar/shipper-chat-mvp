import Link from "next/link";

import { UserProfileClient } from "./UserProfileClient";

export const runtime = "nodejs";

export default async function UserProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  return (
    <div className="chat-theme min-h-screen bg-chat-bg text-chat-text">
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-chat-text">Public profile</div>
            <div className="text-sm text-chat-muted">View user details.</div>
          </div>
          <Link
            href="/chat"
            className="rounded-chat-lg border border-chat-border bg-chat-surface px-3 py-2 text-xs font-medium text-chat-text/90 hover:bg-chat-bg"
          >
            Back to chat
          </Link>
        </div>

        <div className="rounded-chat-xl border border-chat-border bg-chat-surface p-6 shadow-chat-card">
          <UserProfileClient userId={userId} />
        </div>
      </div>
    </div>
  );
}

