import type { NextConfig } from "next";

// The browser only ever talks to this origin; /api is proxied to the API, so
// no CORS, no API address in the bundle, and model keys never leave the server.
const apiOrigin = process.env.API_ORIGIN ?? "http://localhost:4000";

const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  transpilePackages: ["@healtrip/contracts"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
  async redirects() {
    return [{ source: "/", destination: "/en", permanent: false }];
  },
};

export default config;
