import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "prod-files-secure.s3.*.amazonaws.com",
      },
    ],
    deviceSizes: [320, 640, 800, 1200],
    imageSizes: [320, 640, 800, 1200],
  },
};

export default nextConfig;
