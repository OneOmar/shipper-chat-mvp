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

- Deploy this folder as a Node service.
- Ensure these env vars are set in the host:
  - `DATABASE_URL`
  - `JWT_SECRET` (must match the frontend)
  - `AUTH_COOKIE_NAME` (must match the frontend)
  - `FRONTEND_URL` and/or `PUBLIC_APP_ORIGIN`

The frontend will proxy `/api/*` and `/socket.io/*` to this service using `BACKEND_URL`.
