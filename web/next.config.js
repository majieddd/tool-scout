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
};

module.exports = nextConfig;
