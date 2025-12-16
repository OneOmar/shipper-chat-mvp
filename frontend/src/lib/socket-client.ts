import { io, type ManagerOptions, type Socket, type SocketOptions } from "socket.io-client";

/**
 * In development, Next.js rewrites/proxying can be flaky for Engine.IO polling (cookies/headers),
 * which can surface as `400 Session ID unknown`.
 *
 * If `NEXT_PUBLIC_SOCKET_SERVER_URL` is set (e.g. `http://localhost:3001`), we connect directly
 * to the socket server and avoid the Next dev proxy entirely. In production you can omit this
 * to use same-origin `/socket.io`.
 */
export function createClientSocket(opts: Partial<ManagerOptions & SocketOptions> = {}): Socket {
  const baseUrl = process.env.NEXT_PUBLIC_SOCKET_SERVER_URL;
  const options = { path: "/socket.io", withCredentials: true, ...opts };
  return baseUrl ? io(baseUrl, options) : io(options);
}


