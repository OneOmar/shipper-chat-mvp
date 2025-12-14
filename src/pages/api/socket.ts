import type { Server as HttpServer } from "http";
import type { Socket } from "net";
import type { NextApiRequest, NextApiResponse } from "next";
import type { Server as SocketIOServer } from "socket.io";

import { attachSocketServer } from "@/server/socket";

type NextApiResponseWithSocket = NextApiResponse & {
  socket: Socket & {
    server: HttpServer & {
      io?: SocketIOServer;
    };
  };
};

export const config = {
  api: { bodyParser: false }
};

export default function handler(_req: NextApiRequest, res: NextApiResponseWithSocket) {
  if (!res.socket.server.io) {
    res.socket.server.io = attachSocketServer(res.socket.server);
  }
  res.end();
}


