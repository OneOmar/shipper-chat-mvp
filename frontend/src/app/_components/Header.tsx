import Link from "next/link";

export function Header({ isAuthed }: { isAuthed: boolean }) {
  return (
    <header className="border-b border-zinc-800">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight text-zinc-100">
          Shipper Chat
        </Link>

        <nav className="flex items-center gap-2">
          {isAuthed ? (
            <Link
              href="/chat"
              className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
            >
              Go to Chat
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-900"
              >
                Login
              </Link>
              <Link
                href="/register"
                className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
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


