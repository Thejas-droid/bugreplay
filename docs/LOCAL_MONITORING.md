# Automatic local monitoring

This implementation replaces the extension's manual start/stop/download flow with automatic incidents. It is intended for local testing with the built application. There are no paid services, remote storage, subscriptions, telemetry, or account requirements in the capture/delivery path.

## Run it

Use Node.js 22+ in the same environment as your terminal. On Windows use Windows Node with PowerShell, or install Linux Node inside WSL.

If switching between Windows and WSL, reinstall dependencies with `pnpm install --force`; native build tools and dependency links are specific to that environment.

```bash
npx pnpm@10.12.1 install
npx pnpm@10.12.1 local:build
npx pnpm@10.12.1 local:start
```

Open http://localhost:5174. Load `apps/extension/dist` as an unpacked extension in Chrome/Edge 120+ with Developer mode. Expand **Connect your browser extension**, copy the pairing token into the popup, choose screenshot capture, and turn monitoring on. Reload the extension after rebuilding it. No Chrome Web Store publication or developer registration is required for this local setup.

The popup controls the window containing the active tab. Monitoring covers its existing and newly opened normal websites and resumes on navigation/reload. Other windows stay off until explicitly enabled. A browser restart resets monitoring consent; the offline queue and pairing token survive. The dashboard itself is excluded from capture.

To exercise the existing practice app alongside the inbox, run `pnpm dev`, enable monitoring, and use http://localhost:5173. The practice recorder's own SDK/manual recording is separate; you do not need to press its Start recording button to test extension detection. The extension also works without modifying another website's source code.

## What is captured

- Uncaught JavaScript exceptions and unhandled promise rejections.
- `console.error` calls; warnings are context, not incident triggers.
- Failed fetch/XHR requests, including unsuccessful HTTP responses.
- Resource-load errors exposed by the page, such as failed images/scripts.
- Recent user interactions, navigation, redacted page structure, requests, and available performance context.
- Optional screenshots of the error tab when it is visible in its window. Inputs, textareas, selects, marked sensitive regions, iframes, and open Shadow DOM hosts are covered before capture. Tab/document changes cause the image to be discarded.

The recorder keeps a rolling 60-second/5 MB context buffer, capped at 20,000 retained events. It waits approximately one second after the first error for nearby context and creates at most one incident per ten seconds per page. Errors in the interval remain in that incident's event history; related errors are grouped rather than creating one download or report per message. Different incident histories may overlap. Delivery retries use the incident's stable ID and are deduplicated on disk.

Each incident includes a fresh redacted page snapshot. Page snapshots are diagnostic HTML, not video or a guaranteed faithful session replay. Original network bodies and browser storage are disabled in the extension. The existing CLI can attempt action replay using the captured steps; third-party pages, hidden inputs, authentication, and missing response bodies can limit reproduction.

## Silent delivery and persistence

The MAIN-world recorder instruments page APIs. An isolated content-script bridge forwards only incident data to the extension service worker. The service worker validates the archive and monitoring scope, persists it in IndexedDB, optionally adds a screenshot, and posts it to the loopback dashboard API with the pairing token. The page never receives that token or permission to invoke extension commands.

No `downloads` permission or automatic download call is used. When the dashboard is unavailable, up to 50 incidents/100 MB remain in the extension's persistent outbox. Delivery retries every 30 seconds and can be retried from the popup. A full queue rejects new captures visibly in the popup; the current page retains its pending incident for retry while it remains open. Pending page-memory data can be lost when a page closes or navigates before the worker acknowledges persistence.

The local server binds to `127.0.0.1:5174`, checks Host/Origin headers, validates uploaded archives, requires a pairing token for uploads, and accepts dashboard reads only with a same-origin request header. It writes archives atomically and deduplicates retry IDs across restarts. This is a local service, not an Internet-facing multi-user backend.

Recordings and the pairing token live in `.bugreplay-data` in the project root by default. The directory is ignored by Git. `BUGREPLAY_DATA_DIR` can select another directory. Retention keeps the newest 200 recordings within 500 MB, deleting the oldest on new arrivals. Delete individual incidents from the inbox; explicit export/share remains available in the viewer. Do not remove the data directory unless you intend to delete its recordings and pairing token.

## Browser and privacy limits

An extension cannot promise every error on every page. Protected browser pages, the Chrome Web Store, unavailable host permissions, closed Shadow DOM, cross-origin frames, sites that replace instrumented APIs, and some browser-internal network failures are outside this implementation's capture scope. The current recorder operates in the top frame. Monitoring starts after the extension's page-start handshake, so very early startup errors can occur before instrumentation is active. Page unload capture is best effort. Errors caught and suppressed by an application and visual/business-logic bugs without diagnostic signals need a user report.

Background-tab errors receive event captures without screenshots. Images capture the visible viewport near the incident, not a frame from the exact exception instant. Switching tabs, protected-page restrictions, or capture quotas can omit an image. There is no continuous video recorder in this implementation. Chrome's tab/video capture requires a separate user-initiated capture lifecycle; adding it would require explicit controls, storage limits, and additional privacy review.

Masking is rule based. Private text elsewhere on the page or in logs may remain. Review recordings before sharing, and disable screenshots or monitoring on sensitive sites. Extension host access covers all URLs so it can follow websites across the enabled window; actual capture is gated by that window's monitoring setting. The page-world bridge is an untrusted data boundary: a hostile monitored page can fabricate incident content, but cannot obtain the pairing token, control other tabs, or choose upload destinations through that bridge.

## Research and implementation choices

Chrome documents the [isolated versus MAIN execution worlds and content-script lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) and [scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting). MAIN-world instrumentation is needed to observe the actual website's console/fetch APIs; the isolated bridge keeps extension credentials outside that world.

The [Tabs API](https://developer.chrome.com/docs/extensions/reference/api/tabs) limits screenshot capture to visible tabs and rate-limits capture calls. [Chrome's screen-capture guide](https://developer.chrome.com/docs/extensions/how-to/web-platform/screen-capture) describes the user action and offscreen-document lifecycle needed for continuous video. This version uses automatic incident screenshots and avoids a permanent screen-sharing session.

Similar open-source projects include [OpenJam](https://github.com/SaintPepsi/openjam), which combines console/network diagnostics with screenshots and replay, and [rrweb's extension](https://rrweb.com/docs/packages/web-extension/), which demonstrates extension-based page recording/replay. These support the architecture's practicality. We retained BugReplay's existing recorder and trace format instead of adding a hosted replay service or replacing the data model.

## Validation

Run `pnpm local:build`, `pnpm typecheck`, and `pnpm test`. Collector integration tests cover authenticated delivery, hostile-origin/Host rejection, invalid archives, duplicate retries, restart persistence, deletion, and 200-incident retention. Recorder tests verify that incident snapshots do not stop monitoring and observers only see redacted events.

For the real-browser smoke test, install Chromium once with `pnpm --filter @bugreplay/cli exec playwright install chromium`, stop any dashboard already using port 5174, then run `pnpm test:extension`. It builds on the existing Playwright dependency and uses a temporary local server, website fixture, browser profile, and data directory. Run `pnpm local:build` first. The test covers automatic error capture, screenshots, redaction, no downloads, reload/new-tab monitoring, offline queuing, restart/retry, grouped error types, monitoring off, and opening incidents in the dashboard.

This validates a local implementation, not a broad production certification. Hosted deployment, multi-user authentication, browser-store distribution, complete iframe capture, continuous video, exhaustive privacy detection, and measured long-running performance remain separate work.
