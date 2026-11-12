import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  experimental: {
    // Cohort file uploads are server actions; the default 1 MB body limit
    // would reject every transcript. Keep this at the documented cap.
    serverActions: { bodySizeLimit: "50mb" },
  },
  reactStrictMode: true,
  // The LabOps host runs the gateway as `node server.js` under systemd.
  output: "standalone",
  pageExtensions: ["js", "jsx", "mdx", "ts", "tsx"],
};

const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm"],
  },
});

export default withMDX(nextConfig);
