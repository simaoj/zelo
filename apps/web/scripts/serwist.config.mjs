// Bundles src/pwa/sw/sw.ts → public/sw.js AFTER `next build` (works with Turbopack builds).
// Precache = versioned static assets (.next/static), public/ files and prerendered (static) HTML
// shells. Prerendered HTML is generated at build time without any request/cookie, so it never
// contains personal data. API responses are never precached or runtime-cached.
import { serwist } from '@serwist/next/config';

export default serwist({
  swSrc: 'src/pwa/sw/sw.ts',
  swDest: 'public/sw.js',
  precachePrerendered: true,
  globIgnores: ['public/**/*.map'],
  maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
});
