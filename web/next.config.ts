import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 固定项目根,避免 Next 因为上层多个 lockfile 选错 workspace 根
  turbopack: { root: import.meta.dirname },
};

export default nextConfig;
