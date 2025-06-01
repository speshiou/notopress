import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.amazonaws.com",
      },
    ],
    deviceSizes: [320, 640, 800, 1200],
    imageSizes: [320, 640, 800, 1200],
    minimumCacheTTL: 2678400, // 31 days
  },
};

export default nextConfig;
