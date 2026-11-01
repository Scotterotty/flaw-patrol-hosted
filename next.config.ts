import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  // `npm run release` packs this self-contained server into the ready-to-run build.
  // `node start.mjs --fast` runs `next start` instead, which doesn't need it (ver_129).
  output: process.env.FP_PLAIN_BUILD ? undefined : "standalone",
  // The version under Arrange menu order and in the name menu (ver_122). Inlined at build so client code needn't ship package.json.
  env: { APP_VERSION: pkg.version },
  experimental: {
    // Screen recordings attach up to 75 MB (other files stay at 10 MB, checked in uploadAttachment).
    serverActions: { bodySizeLimit: "80mb" },
    // Uploads pass through src/middleware.ts, which otherwise cuts request bodies off at 10 MB. Zips of automation results go up to 200 MB (ver_93).
    middlewareClientMaxBodySize: "210mb",
  },
};

export default nextConfig;
