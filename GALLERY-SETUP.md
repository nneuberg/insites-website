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

## Automatic front exterior recognition (staged)

The gallery-cover-scan function runs once per minute on production, but only when GALLERY_AI_ENABLED is true and GALLERY_GEMINI_API_KEY is configured. It sends up to 12 small previews per tick to Google's gemini-2.5-flash-lite model and saves choices in the gallery-front-covers Netlify Blobs store. Complete albums are checked for changed photos every six hours. A backlog of existing albums is processed gradually; no AI requests are triggered by visitors.

Only front-view classifications with confidence at least 0.85 qualify. The selector prefers complete, well-composed front elevations and rejects rear/side views, interiors and uncertain results. An album without a qualifying image uses a neutral placeholder. Recognition remains probabilistic; front/rear mistakes are still possible.

GALLERY_AI_MONTHLY_USD defaults to 5 and cannot exceed 5. GALLERY_AI_MAX_CALLS defaults to 1000 and cannot exceed 1000. Each call reserves $0.12 before execution, conservatively covering the configured model's entire input context and bounded output at Google's verified published rates ($0.10/M input tokens and $0.40/M output tokens). On a successful response with valid usage metadata, the reservation is settled to its token-based estimate. Unknown outcomes retain the full reservation. Reaching either limit stops model calls until the next UTC month. This is an application-side limit based on published rates, not a provider billing-account limit. The Google account's billing tier controls whether actual charges apply.

Activation requires a Gemini API key stored as a Netlify secret, explicit approval to send these gallery previews to Google, and approval for the monthly spending limit. These are not yet configured. Mock-based tests verify selection, quota/budget handling, conditional writes, resume logic and fixed-folder restrictions; live image recognition remains unverified until activation.
