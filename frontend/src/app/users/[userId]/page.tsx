import Link from "next/link";

import { UserProfileClient } from "./UserProfileClient";

export const runtime = "nodejs";

export default async function UserProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-2xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold">Public profile</div>
            <div className="text-sm text-zinc-500">View user details.</div>
          </div>
          <Link
            href="/chat"
            className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-900"
          >
            Back to chat
          </Link>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6">
          <UserProfileClient userId={userId} />
        </div>
      </div>
    </div>
  );
}

