import Link from "next/link";

export function HeroSection({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="px-6 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-6xl">
        <div className="rounded-chat-xl border border-chat-border bg-chat-surface px-6 py-10 shadow-chat-card sm:px-10 sm:py-14">
          <div className="mx-auto max-w-2xl text-center">
            <p className="inline-flex items-center rounded-full border border-chat-border bg-chat-surface px-3 py-1 text-xs font-medium text-chat-muted">
              Real‑time chat • Presence • AI
            </p>

            <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight text-chat-text sm:text-5xl">
              Real‑time conversations for shipper workflows.
            </h1>

            <p className="mt-5 text-pretty text-base leading-7 text-chat-muted">
              Secure sign‑in, live presence, and fast messaging — built for a clean, production‑ready chat MVP.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              {isAuthed ? (
                <Link
                  href="/chat"
                  className="inline-flex w-full items-center justify-center rounded-chat-lg bg-chat-primary px-5 py-3 text-sm font-semibold text-chat-primary-foreground hover:brightness-[0.98] sm:w-auto"
                >
                  Go to Chat
                </Link>
              ) : (
                <Link
                  href="/register"
                  className="inline-flex w-full items-center justify-center rounded-chat-lg bg-chat-primary px-5 py-3 text-sm font-semibold text-chat-primary-foreground hover:brightness-[0.98] sm:w-auto"
                >
                  Get Started
                </Link>
              )}

              {!isAuthed ? (
                <Link
                  href="/login"
                  className="inline-flex w-full items-center justify-center rounded-chat-lg border border-chat-border bg-chat-surface px-5 py-3 text-sm font-semibold text-chat-text/90 hover:bg-chat-bg sm:w-auto"
                >
                  Login
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}


