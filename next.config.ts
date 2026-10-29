import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `npm run release` packs this self-contained server into the ready-to-run build.
  output: "standalone",
  experimental: {
    // Screen recordings attach up to 75 MB (other files stay at 10 MB, checked in uploadAttachment).
    serverActions: { bodySizeLimit: "80mb" },
    // Uploads pass through src/middleware.ts, which otherwise cuts request bodies off at 10 MB. Zips of automation results go up to 200 MB (ver_93).
    middlewareClientMaxBodySize: "210mb",
  },
};

export default nextConfig;
