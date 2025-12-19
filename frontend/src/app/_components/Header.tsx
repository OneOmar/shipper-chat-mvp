import Link from "next/link";
import Image from "next/image";

export function Header({ isAuthed }: { isAuthed: boolean }) {
  return (
    <header className="border-b border-chat-border bg-chat-surface">
      <div className="mx-auto flex h-[72px] w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-3 text-sm font-semibold tracking-tight text-chat-text">
          <span className="relative h-9 w-9 overflow-hidden rounded-full">
            <Image src="/logo.png" alt="Shipper Chat" width={36} height={36} className="h-9 w-9" priority />
          </span>
          <span>Shipper Chat</span>
        </Link>

        <nav className="flex items-center gap-2">
          {isAuthed ? (
            <>
              <Link
                href="/profile"
                className="rounded-chat-lg border border-chat-border bg-chat-surface px-3 py-2 text-xs font-medium text-chat-text/90 hover:bg-chat-bg"
              >
                Profile
              </Link>
              <Link
                href="/chat"
                className="rounded-chat-lg bg-chat-primary px-3 py-2 text-xs font-medium text-chat-primary-foreground hover:brightness-[0.98]"
              >
                Go to Chat
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-chat-lg border border-chat-border bg-chat-surface px-3 py-2 text-xs font-medium text-chat-text/90 hover:bg-chat-bg"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="rounded-chat-lg bg-chat-primary px-3 py-2 text-xs font-medium text-chat-primary-foreground hover:brightness-[0.98]"
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}


