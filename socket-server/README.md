## Standalone Socket.IO server

This repo’s realtime server is extracted into `socket-server/` to avoid Vercel’s serverless WebSocket limitations.

### Run locally

- **Install**:

```bash
npm install
npm install --prefix socket-server
```

- **Configure env**:
  - Copy `socket-server/.env.example` → `socket-server/.env`
  - Ensure `JWT_SECRET` and `DATABASE_URL` match your Next.js app
  - In your Next.js `.env.local`, set:
    - `SOCKET_SERVER_URL=http://localhost:3001`

- **Start** (two terminals):

```bash
npm run dev
```

```bash
npm run dev --prefix socket-server
```

The frontend remains unchanged and continues to call `/api/socket` and connect to `/socket.io`; Next.js proxies those paths to the standalone server via `next.config.ts`.

### Deploy

- **Deploy the socket server** to any Node-friendly host (Railway/Fly/Render/VM/K8s).
- Set its env vars from `socket-server/.env.example`.
- In Vercel (frontend), set `SOCKET_SERVER_URL` to your deployed socket server base URL (e.g. `https://your-socket-host.example`).

