import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  devIndicators: false,
  // Dev only: hosts (e.g. this machine's LAN IP) allowed to load the dev server, for testing on a phone.
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGINS?.split(",").filter(Boolean),
};

export default nextConfig;
