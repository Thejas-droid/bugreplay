# BugReplay

**Turn “the button broke” into a recording that explains what happened.**

BugReplay automatically monitors websites through a Chrome/Edge extension, captures frontend errors with recent activity and optional screenshots, and delivers incidents silently to a dashboard on your computer. No browser downloads are triggered. Portable `.bugreplay` files and the practice recorder remain available for manual workflows.

No account, paid API, cloud storage, or hosting is required. The local dashboard server stores recordings on your device until you choose to share them. See [local implementation and research](docs/LOCAL_MONITORING.md).

## Start here

Install **Node.js 22 or newer** in the terminal environment you use. On Windows, use PowerShell with Windows Node. In WSL, install Linux Node inside WSL; a Windows npm launcher does not supply Linux Node.

From this project folder:

```bash
npx pnpm@10.12.1 install
npx pnpm@10.12.1 dev
```

- **Practice recorder:** http://localhost:5173
- **Recording viewer:** http://localhost:5174

`dev` starts both apps. The ports are fixed; stop an older server if a port is already in use. The project uses pnpm workspaces; `npm install` does not link the internal packages and is intentionally blocked.

If pnpm is installed, you can use `pnpm install` and `pnpm dev` directly. Individual apps: `pnpm demo` and `pnpm viewer`.

## A two-minute walkthrough

1. Open the practice recorder and choose **Checkout stops**.
2. Press **Start recording**.
3. Enter `SAVE20`, press **Apply coupon**, then **Place order**.
4. Describe what went wrong and press **Stop & save recording**.
5. Open the viewer and select the downloaded `.bugreplay` file.
6. Read the summary and the numbered steps. Inspect the error and its nearby activity.
7. Choose **Share report**, add the expected outcome, and download or copy the report.

For a quick presentation without recording anything, open the viewer and select **Explore an example**. Example events are explicitly fictional; direct issue creation is disabled for them.

The practice APIs run inside Vite and use local fake data. They do not require an external API or make a real purchase. The six primary scenarios cover runtime errors, failed requests, slow work, layout movement, private fields, and a coupon race. Additional developer fixtures cover navigation, promise rejection, request cancellation, Shadow DOM, and dynamic content.

## Explain it in one sentence

> BugReplay turns a frontend bug into a local file containing the steps and technical clues, so a developer can understand it, reproduce it, and share a useful report.

## Replay a recording

Start the target application and install the replay browser once:

```bash
pnpm --filter @bugreplay/cli exec playwright install chromium
pnpm cli doctor
pnpm cli replay trace.bugreplay --base-url http://localhost:5173 --network live
```

The viewer’s **Replay** section prepares a command for you. Replay runs through the CLI, not inside the viewer.

```bash
# Use captured API responses where available
pnpm cli replay trace.bugreplay --base-url http://localhost:5173 --network hybrid --mock '/api/*'

# Repeat on separate browser contexts
pnpm cli replay trace.bugreplay --base-url http://localhost:5173 --repeat 5

# Check a fix: requires captured original errors and no replay errors
pnpm cli replay trace.bugreplay --base-url http://localhost:5173 --expect-fixed

# Create a starting script for a developer to review
pnpm cli generate-test trace.bugreplay --out bugreplay.generated.spec.ts
```

The practice runtime-error fixture supports a fixed version at `?fixed=1`. After recording the failure, use `pnpm cli replay trace.bugreplay --base-url "http://localhost:5173?fixed=1" --expect-fixed` to check the fixed variant. Other fixture changes may require selecting or preparing the appropriate target build. Opening a file does not prove a successful replay. Hidden inputs need safe replacements; incomplete recordings and missing response bodies can prevent reproduction. See [replay details](docs/REPLAY.md).

## Monitor real websites locally — free

Install dependencies once with Node.js 22 or newer, then build the extension and dashboard:

```bash
npx pnpm@10.12.1 install
npx pnpm@10.12.1 local:build
npx pnpm@10.12.1 local:start
```

1. Open **http://localhost:5174** and expand **Connect your browser extension** in the incident inbox.
2. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**, choose **Load unpacked**, and select `apps/extension/dist`.
3. Copy the dashboard pairing token into the extension popup.
4. Choose whether to include masked screenshots, then press **Turn monitoring on** in the window you want to monitor.
5. Use any normal website in that window. JavaScript errors, unhandled rejections, console errors, failed fetch/XHR requests, HTTP errors, and failed page resources are detected automatically. New tabs and reloads resume monitoring.
6. Incidents appear in the inbox automatically. Select one to inspect its timeline, errors, requests, page snapshots, and screenshots.

There is no start/stop step for each bug, no automatic download, and no hosted service. Keep the local server running while viewing incidents. If it stops, the extension queues incidents on disk and retries delivery every 30 seconds. **Turn monitoring off** stops capture in that window. A browser restart turns monitoring off; queued incidents remain.

The extension monitors top-level HTTP(S) pages, subject to Chrome's site-access permissions and protected-page restrictions. It cannot detect every visual/logic bug or errors hidden inside cross-origin frames. Screenshots cover the visible tab only and may contain private information outside masked fields. Continuous video is not implemented. Error bursts are grouped; retention is bounded. Review [capture limits and privacy](docs/LOCAL_MONITORING.md) before using it on sensitive sites.

For development, `pnpm viewer` runs the same inbox API through Vite; `pnpm dev` also starts the practice app. The built dashboard uses `pnpm local:start`, without a Vite development server.

## Reports and issue trackers

Reports contain readable steps, the recorded environment, errors, requests, slowdowns, and redaction counts. Downloading or copying a report does not upload the recording.

The viewer supports explicit, previewed GitHub/Jira submission. Jira commonly blocks browser requests through cross-origin rules; use a downloaded report or the CLI in that case. CLI tokens come from environment variables, not recording files:

```bash
# Preview only
pnpm cli export github trace.bugreplay --repo owner/repository

# After reviewing; set GITHUB_TOKEN in your terminal environment first
pnpm cli export github trace.bugreplay --repo owner/repository --confirm
```

For Jira, supply `--site https://team.atlassian.net --project TEAM` and set `JIRA_EMAIL` / `JIRA_TOKEN`. Attach the trace separately if appropriate. No attachment hosting service is included.

## Status and scope

This is a substantial local-first implementation, **not a certified complete implementation of every PRD requirement**. The implementation audit, research rationale, unresolved gaps, and validation status are documented in:

- [PRD audit and remaining work](docs/PRD_AUDIT.md)
- [UI/UX research and design decisions](docs/UX_RESEARCH.md)
- [Presenter guide](docs/PRESENTATION.md)
- [Implementation status](IMPLEMENTATION_STATUS.md)

The automatic local monitoring implementation has its own validation and scope notes in [LOCAL_MONITORING.md](docs/LOCAL_MONITORING.md). Earlier audit documents describe the previous manual-capture implementation. Broad production deployment and performance certification remain outside the local test setup.

## Packages

`recorder-core` captures events; `browser-sdk` provides the app API; `redaction` masks configured sensitive data; `trace-format` validates and encodes files; `replay-engine` repeats actions with Playwright; `exporters` produces reports and issues; `shared` defines the data model. Apps include the practice checkout, viewer, extension, and CLI.

See [SDK usage](docs/SDK.md), [privacy](docs/PRIVACY.md), [security](docs/SECURITY.md), and [format](docs/TRACE_FORMAT.md).
