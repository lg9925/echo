import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import withSerwistInit from "@serwist/next";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  cacheOnNavigation: true,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // Dev-only: accept requests proxied from this domain (Cloudflare Tunnel →
  // localhost:3000) so on-device testing over echo.helloworldhub.xyz works.
  allowedDevOrigins: ["echo.helloworldhub.xyz"],
};

export default withSerwist(withNextIntl(nextConfig));
