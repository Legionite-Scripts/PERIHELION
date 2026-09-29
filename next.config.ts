import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The dev badge sits in the corner of a frame we are art-directing.
  devIndicators: false,
  // Pin the workspace root: without this, Turbopack walks up to the home
  // directory looking for a lockfile.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
