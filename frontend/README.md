## Frontend (Next.js)

This folder contains the Next.js app intended for deployment on **Vercel**.

### Local development

- Install:

```bash
cd frontend
npm install
```

- Configure env:
  - Copy `env.example` → `.env.local`
  - Set `BACKEND_URL` to your backend base URL (local: `http://localhost:3001`).

- Run:

```bash
npm run dev
```

### Production (Vercel)

- Set the same env vars as `.env.example` (notably `BACKEND_URL`, `JWT_SECRET`, `AUTH_COOKIE_NAME`).
- (Cursor security note: this repo uses `env.example` instead of `.env.example`.)
- The frontend talks to the backend via **same-origin** paths (`/api/*`, `/socket.io/*`) which Vercel proxies to `BACKEND_URL` using `next.config.ts` rewrites.
