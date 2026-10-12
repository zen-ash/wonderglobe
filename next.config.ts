import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Three.js ships modern ESM; nothing special is required, but keep the
  // bundle honest about which code is browser-only.
  poweredByHeader: false,
};

export default nextConfig;
