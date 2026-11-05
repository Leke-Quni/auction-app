import { config } from "dotenv";
import type { NextConfig } from "next";
import { resolve } from "node:path";

config({ path: resolve(__dirname, "../../.env") });
// The admin app has its own address; the storefront's AUTH_URL (from the shared .env) must not leak into its sign-in redirects.
process.env.AUTH_URL = process.env.ADMIN_URL ?? "http://localhost:3001";

const nextConfig: NextConfig = {
  transpilePackages: ["@auction/ui"],
};

export default nextConfig;
