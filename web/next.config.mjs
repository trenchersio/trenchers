/** @type {import('next').NextConfig} */
const preview = process.env.PREVIEW_EXPORT === "1";
export default {
  reactStrictMode: true,
  // Native PNG renderer for share images (Telegram posts, previews); loaded at runtime, not bundled.
  serverExternalPackages: ["@resvg/resvg-js"],
  // PREVIEW_EXPORT=1 builds a static copy with relative paths, for a shareable preview link.
  ...(preview ? { output: "export", assetPrefix: ".", images: { unoptimized: true } } : {}),
  webpack: (config) => {
    // Optional dependencies of wallet connectors that this site never uses.
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
    };
    return config;
  },
};
