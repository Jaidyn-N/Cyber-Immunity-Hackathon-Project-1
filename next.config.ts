import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack(config) {
    config.module.strictExportPresence = false;
    config.resolve.alias["@tidecloak/react"] = require.resolve("@tidecloak/react");
    return config;
  },
  async rewrites() {
    return [
      { source: "/tide_dpop/:path*", destination: "/tide_dpop_auth.html" },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-src 'self' *" },
        ],
      },
      {
        source: "/tide_dpop/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'unsafe-inline'",
          },
          { key: "Allow-CSP-From", value: "*" },
        ],
      },
    ];
  },
};

export default nextConfig;
