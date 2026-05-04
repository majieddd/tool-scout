/** @type {import('next').NextConfig} */

// Static export for GitHub Pages deployment. Pages serves at
// https://<owner>.github.io/<repo>/ so basePath is required when
// DEPLOY_TARGET=github-pages. For local dev (`npm run dev`) or local
// build verification, leave DEPLOY_TARGET unset to serve at /.
const isPages = process.env.DEPLOY_TARGET === "github-pages";
const repoName = "tool-scout";

const nextConfig = {
  reactStrictMode: true,
  output: "export",
  trailingSlash: true,
  images: {
    unoptimized: true, // GitHub Pages has no image optimizer
  },
  basePath: isPages ? `/${repoName}` : "",
  assetPrefix: isPages ? `/${repoName}/` : "",
  // Note: static export disallows custom headers() — security headers must
  // be set at the host. GitHub Pages provides sane defaults.
  webpack: (config) => {
    // @huggingface/transformers has dual node/web builds. The Node build
    // pulls in onnxruntime-node which contains .node binaries that webpack
    // can't bundle. We never want the Node build — even Next's server-
    // render pass for static export shouldn't load it (the AIRefinement
    // component is "use client" and only runs in the browser).
    // Alias to the web build for ALL bundles (server + client).
    const path = require("path");
    const transformersWebPath = path.resolve(
      __dirname,
      "node_modules/@huggingface/transformers/dist/transformers.web.js",
    );
    config.resolve.alias = {
      ...config.resolve.alias,
      "@huggingface/transformers$": transformersWebPath,
      "@huggingface/transformers": transformersWebPath,
      "onnxruntime-node": false,
    };
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
      sharp: false,
      "onnxruntime-node": false,
    };
    return config;
  },
};

module.exports = nextConfig;
