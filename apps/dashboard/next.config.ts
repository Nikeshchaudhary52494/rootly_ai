import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@incident-ai/shared"],
  agentRules: false,
};

export default nextConfig;
