## Backend (Node.js + Express + Socket.IO)

This folder contains the standalone backend service (REST API + Socket.IO) intended for deployment on **Railway / Render / Fly.io**.

### What lives here

- **REST API** under `/api/*` (auth, users, chat session management)
- **Socket.IO** server under `/socket.io/*` (realtime chat)
- **Prisma** schema and migrations under `prisma/`

### Local development

- Install:

```bash
cd backend
npm install
```

- Configure env:
  - Copy `env.example` → `.env`
  - Ensure `DATABASE_URL`, `JWT_SECRET`, `AUTH_COOKIE_NAME` are set.
  - If using Google OAuth, set `GOOGLE_*` vars.

- Prisma generate:

```bash
npm run prisma:generate
```

- Run:

```bash
npm run dev
```

### Production deployment

- Deploy this folder as a Node service (Railway recommended).
- Ensure these env vars are set in the host:
  - `DATABASE_URL`
  - `JWT_SECRET` (**must match the frontend**)
  - `AUTH_COOKIE_NAME` (**must match the frontend**, default `auth_token`)
  - `FRONTEND_URL` (comma-separated allow-list for Socket.IO CORS in production)
  - `PUBLIC_APP_ORIGIN` (public origin used for absolute redirects, e.g. OAuth)

The frontend will proxy `/api/*` and `/socket.io/*` to this service using `BACKEND_URL`.

#### Railway checklist

- **Service root directory**: `backend/`
- **Install**: `npm install`
- **Start command**: `npm start`
- **Health check**: `GET /healthz` should return `ok`
- **Database migrations (required)**:
  - Run `npx prisma migrate deploy` during deploy/release (recommended)
  - `prisma generate` runs on install via `postinstall`

#### Env vars (production)

- **Required**
  - `DATABASE_URL`: Postgres connection string
  - `JWT_SECRET`: shared with Vercel (frontend)
  - `AUTH_COOKIE_NAME`: shared with Vercel (frontend)
  - `FRONTEND_URL`: e.g. `https://<your-vercel-domain>` (or `https://a.vercel.app,https://custom-domain.com`)
  - `PUBLIC_APP_ORIGIN`: e.g. `https://<your-vercel-domain>`
- **Optional**
  - **Google OAuth**: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
    - `GOOGLE_REDIRECT_URI` should be `https://<your-vercel-domain>/api/auth/google/callback` (not the Railway domain)
  - **AI chat**: `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_USER_EMAIL`

#### Common production pitfalls

- **Migrations not applied**: the service may boot but fail on DB queries → run `prisma migrate deploy`.
- **JWT mismatch**: if `JWT_SECRET` differs between frontend and backend, auth cookies validate in one place but not the other.
- **CORS allow-list**: if `FRONTEND_URL` does not include your Vercel domain, Socket.IO handshake can fail in production.
