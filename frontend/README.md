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

#### Vercel checklist

- **Project root directory**: `frontend/`
- **Build command**: `npm run build`
- **Install command**: `npm install`
- **Output**: default Next.js

#### Env vars (production)

- **Required**
  - `BACKEND_URL`: your Railway backend base URL, e.g. `https://<service>.up.railway.app`
  - `JWT_SECRET`: shared with Railway (backend)
  - `AUTH_COOKIE_NAME`: shared with Railway (backend)
- **Recommended**
  - Leave `NEXT_PUBLIC_SOCKET_SERVER_URL` **unset/empty** in production

#### Common production pitfalls

- **Do not set `NEXT_PUBLIC_SOCKET_SERVER_URL` to Railway in production**:
  - The auth cookie is set on the Vercel domain, so a cross-origin Socket.IO connection to Railway will not receive that cookie.
  - Correct setup is: browser connects to same-origin `/socket.io` and Vercel rewrites proxy to `BACKEND_URL`.
- **OAuth redirect URI**:
  - If using Google OAuth, the callback should be on Vercel: `https://<your-vercel-domain>/api/auth/google/callback`.
