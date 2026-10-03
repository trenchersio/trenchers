/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
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
