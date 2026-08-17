import type { NextConfig } from "next";

const deploymentBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  basePath: deploymentBasePath,
};

export default nextConfig;
