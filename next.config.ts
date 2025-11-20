import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: ["@google-cloud/tasks"],
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/@google-cloud/tasks/build/protos/**/*.json"],
  },
};

export default nextConfig;
