import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["unpdf", "@napi-rs/canvas", "pdfjs-dist"],
  outputFileTracingIncludes: {
    "/api/examine": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
      "./node_modules/@napi-rs/canvas/**/*",
    ],
  },
};

export default nextConfig;
