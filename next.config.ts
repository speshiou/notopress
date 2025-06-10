import type { NextConfig } from "next";
import { RemotePattern } from "next/dist/shared/lib/image-config";

// Parse IMAGE_REMOTE_PATTERNS from env, fallback to default if not set or invalid
let remotePatterns: (URL | RemotePattern)[];
try {
  if (process.env.IMAGE_REMOTE_PATTERNS) {
    // Split by comma, trim, and parse each as URL
    remotePatterns = process.env.IMAGE_REMOTE_PATTERNS.split(",").map((s) => {
      return new URL(s.trim());
    });
    if (!remotePatterns.length)
      throw new Error("No valid patterns found in IMAGE_REMOTE_PATTERNS.");
  } else {
    throw new Error("IMAGE_REMOTE_PATTERNS is not set.");
  }
} catch (err) {
  console.warn(
    "[next.config.ts] Failed to parse IMAGE_REMOTE_PATTERNS from .env: " +
      (err instanceof Error ? err.message : String(err)) +
      ". Falling back to default remotePatterns."
  );
  // Fallback to default remote patterns
  // This is a common pattern for Notion images hosted on AWS S3
  remotePatterns = [
    {
      protocol: "https",
      hostname: "prod-files-secure.s3.**.amazonaws.com",
    },
  ];
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns,
    deviceSizes: [320, 640, 800, 1200],
    imageSizes: [320, 640, 800, 1200],
    minimumCacheTTL: 2678400, // 31 days
  },
};

export default nextConfig;
