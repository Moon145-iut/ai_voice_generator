import type { NextConfig } from "next";

// Relative /backend/* requests work on phones too: the browser never calls localhost:8000.
// Next.js proxies them to FastAPI on the host machine.
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/backend/:path*", destination: `${process.env.BACKEND_URL || "http://127.0.0.1:8000"}/:path*` },
    ];
  },
};

export default nextConfig;
