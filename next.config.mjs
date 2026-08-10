/** @type {import('next').NextConfig} */
const distDir = process.env.NEXT_DIST_DIR || ".next";

const nextConfig = {
  output: "standalone",
  distDir,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/favicon.ico",
          destination: "/brand-icon.ico",
        },
      ],
    };
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;
