# InSites Drive gallery

This adds /gallery/ to the existing Netlify website. Each direct child folder of _LISTING PHOTOS becomes an album. Direct image files become photos. Nested folders, videos, and PDFs are excluded. Prefix a folder or photo with an underscore to hide it.

## One-time connection

1. Enable Google Drive API in Google Cloud and create a gallery service account. No domain-wide delegation is needed.
2. Share only folder 1SpgSvuae8ZQ8BEDYGDmr3_0lRF8R-cLs with that account's email as Viewer.
3. Store GALLERY_SERVICE_ACCOUNT_EMAIL and GALLERY_SERVICE_ACCOUNT_PRIVATE_KEY in Netlify environment variables scoped to Functions. Never put the key JSON or private key in GitHub, website files, or chat.
4. Deploy the reviewed branch. Netlify's existing functions directory is already configured.
5. Open /gallery/ and an album. Add a test album containing an image and confirm it appears after Refresh or a one-minute check. Remove it and verify disappearance.

Once deployed the gallery is public, including property folder names and photographs. Only include photos intended for website display in the connected folder. Existing client sharing is preserved.

The gallery queries Drive on visits, Refresh, every minute while visible, and on returning to the tab. No rebuilds or Zapier are needed. Google upload processing may delay previews. Results load in pages of 24; search covers loaded items. Covers use the first visible image by natural filename order. Full-screen viewing uses a large Drive preview rather than the original file. Removed images may remain in browser cache for up to 60 seconds.

## Validation

Seven mock-based tests cover the fixed parent folder restriction, hidden/deleted albums, malformed IDs, pagination, incomplete results, and photo containment. Run: node --test tests/gallery.test.mjs

These tests do not prove live OAuth, Netlify deployment, or end-to-end syncing. Those checks require the connection above. No live Drive permissions have been changed.
