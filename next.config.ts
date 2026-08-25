import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The LabOps host runs the gateway as `node server.js` under systemd.
  output: "standalone",
};

export default nextConfig;
