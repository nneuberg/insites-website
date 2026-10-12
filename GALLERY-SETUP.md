# InSites Drive gallery

The /gallery/ page reads the existing publicly shared _LISTING PHOTOS parent folder. Each direct child folder becomes an album; direct image files become photos. Nested folders, PDFs, and videos are excluded. Prefix an album or photo with an underscore to exclude it from this gallery (this does not revoke its existing Drive sharing).

## Connection

Google Drive API is enabled in project aerobic-factor-451423-p8. The dedicated InSites Gallery API key is restricted to Google Drive API. Netlify stores GALLERY_DRIVE_API_KEY as a secret in production and Deploy Preview contexts. It is not embedded in browser code, repository files, or local development.

This connection reads only files already accessible to anyone with the link. No Drive sharing or organization security policy changes are needed. Newly uploaded folders must inherit the parent's sharing; restricted files cannot be shown by this connection. If the parent becomes private, gallery reads stop.

## Behavior

Results load in pages of 24. Search covers loaded albums/photos. Drive is reread on visits, Refresh, every minute while visible, and on returning to the tab. Refresh returns to the first page. No rebuilds or scheduled jobs are needed for new uploads.

Covers use the first visible image by natural filename order. Full-screen viewing uses a large Drive preview. Google upload processing may delay thumbnails. Removed images may remain in browser cache for up to 60 seconds.

## Validation

Run node --test tests/gallery.test.mjs. Tests check parent-folder restrictions, hidden/deleted folders, malformed IDs, pagination, incomplete results, and photo containment. Live verification must also confirm album reads, thumbnails and full-screen photos through the deployed Netlify endpoints.
