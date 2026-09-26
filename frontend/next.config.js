/** @type {import('next').NextConfig} */
const path = require("node:path");

const nextConfig = {};
nextConfig.outputFileTracingRoot = path.join(__dirname);

module.exports = nextConfig;
