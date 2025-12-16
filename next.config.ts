import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Socket.IO uses `/socket.io/` (trailing slash) for websocket URLs.
  // Next.js can emit 308 trailing-slash redirects which break WS handshakes, so we disable that behavior.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    /**
     * We keep the frontend Socket.IO client untouched (it connects to `/socket.io`
     * and calls `/api/socket`), but we no longer run a Socket.IO server inside Next.js.
     *
     * Instead, we proxy these paths to the standalone socket server.
     */
    const socketBase =
      process.env.SOCKET_SERVER_URL ||
      (process.env.NODE_ENV !== "production" ? "http://localhost:3001" : "");
    if (!socketBase) return [];

    return [
      // Warmup call used by the client before `io(...)`.
      { source: "/api/socket", destination: `${socketBase}/api/socket` },

      // Online user list used by the sidebar.
      { source: "/api/online-users", destination: `${socketBase}/api/online-users` },

      // Socket.IO transport endpoints (polling + websocket upgrade).
      // Next rewrites won't always match the "no-subpath" case via `:path*`, so we include both.
      // Also: Engine.IO expects `/socket.io/` (trailing slash), while the client may hit `/socket.io`.
      { source: "/socket.io", destination: `${socketBase}/socket.io/` },
      { source: "/socket.io/", destination: `${socketBase}/socket.io/` },
      { source: "/socket.io/:path*", destination: `${socketBase}/socket.io/:path*` }
    ];
  }
};

export default nextConfig;


