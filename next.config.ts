import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: ["http://68.183.75.175:3000", "http://68.183.75.175", "http://localhost:3000"],
  experimental: {
    allowedDevOrigins: [
      "http://68.183.75.175:3000",
      "http://68.183.75.175",
      "http://localhost:3000",
    ],
  },
};

export default nextConfig;


