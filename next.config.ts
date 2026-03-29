import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["d3-shape"],
  turbopack: {
    resolveAlias: {
      "d3-shape": "d3-shape/dist/d3-shape.min.js",
    },
  },
};

export default nextConfig;
