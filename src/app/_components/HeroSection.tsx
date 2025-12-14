import Link from "next/link";

export function HeroSection({ isAuthed }: { isAuthed: boolean }) {
  return (
    <section className="relative overflow-hidden">
      {/* Subtle background gradient */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(99,102,241,0.18)_0%,rgba(9,9,11,0)_70%)]"
      />

      <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-24">
        <div className="mx-auto max-w-2xl text-center">
          <p className="inline-flex items-center rounded-full border border-zinc-800 bg-zinc-900/40 px-3 py-1 text-xs text-zinc-300">
            Real‑time chat • Presence • AI
          </p>

          <h1 className="mt-6 text-balance text-4xl font-semibold tracking-tight text-zinc-100 sm:text-5xl">
            Real‑time conversations for shipper workflows.
          </h1>

          <p className="mt-5 text-pretty text-base leading-7 text-zinc-400">
            Secure sign‑in, live presence, and fast messaging — built for a clean, production‑ready chat MVP.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            {isAuthed ? (
              <Link
                href="/chat"
                className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white sm:w-auto"
              >
                Go to Chat
              </Link>
            ) : (
              <Link
                href="/register"
                className="inline-flex w-full items-center justify-center rounded-xl bg-zinc-100 px-5 py-2.5 text-sm font-medium text-zinc-900 hover:bg-white sm:w-auto"
              >
                Get Started
              </Link>
            )}

            {!isAuthed ? (
              <Link
                href="/login"
                className="inline-flex w-full items-center justify-center rounded-xl border border-zinc-800 bg-zinc-900/40 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-zinc-900 sm:w-auto"
              >
                Login
              </Link>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}


