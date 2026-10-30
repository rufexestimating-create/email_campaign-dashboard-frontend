import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Hide the floating "N" development badge; build/runtime errors still show
  devIndicators: false,
};

export default nextConfig;
