import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
