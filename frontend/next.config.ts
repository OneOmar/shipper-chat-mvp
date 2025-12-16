import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Prevent Next from incorrectly inferring the workspace root when multiple lockfiles exist.
  // This keeps file tracing deterministic and silences the dev warning.
  outputFileTracingRoot: __dirname,
  // Socket.IO uses `/socket.io/` (trailing slash) for websocket URLs.
  // Next.js can emit 308 trailing-slash redirects which break WS handshakes, so we disable that behavior.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    /**
     * Communication boundary (frontend -> backend):
     * - REST/HTTP: `/api/*`
     * - Socket.IO: `/socket.io/*`
     *
     * In production (Vercel) this keeps the browser on same-origin URLs while the
     * platform proxies to the standalone backend service.
     */
    const backendBase =
      process.env.BACKEND_URL ||
      process.env.SOCKET_SERVER_URL ||
      (process.env.NODE_ENV !== "production" ? "http://localhost:3001" : "");
    if (!backendBase) return [];

    return [
      // REST API
      { source: "/api/:path*", destination: `${backendBase}/api/:path*` },

      // Socket.IO transport endpoints (polling + websocket upgrade).
      // Next rewrites won't always match the "no-subpath" case via `:path*`, so we include both.
      // Also: Engine.IO expects `/socket.io/` (trailing slash), while the client may hit `/socket.io`.
      { source: "/socket.io", destination: `${backendBase}/socket.io/` },
      { source: "/socket.io/", destination: `${backendBase}/socket.io/` },
      { source: "/socket.io/:path*", destination: `${backendBase}/socket.io/:path*` }
    ];
  }
};

export default nextConfig;


