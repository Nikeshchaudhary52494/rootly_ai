import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@rootly.ai/shared"],
  agentRules: false,
};

export default nextConfig;
