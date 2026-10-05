# Architecture

Capture plugins emit ordered events into a bounded `Recorder` buffer. `Redactor` masks configured sensitive values before retention. Finalization applies another event pass, adds environment/privacy metadata, and encodes a versioned ZIP-compatible `.bugreplay` archive with MessagePack events. The viewer decodes files in a web worker and presents readable steps, searchable virtualized events, escaped snapshots, and reports.

The extension's default flow is enable window monitoring → automatically capture an incident → deliver to the local inbox → understand → share. The practice recorder and SDK also support manual file capture. Developers can replay actions with Playwright and download a starting regression script. No cloud backend or account is required; the inbox uses a loopback-only local server.

## Extension

The popup controls window-scoped monitoring settings in session storage. Only the packaged popup can enable/disable monitoring or configure the pairing token. MAIN-world and isolated content scripts run at document start; the isolated script asks the service worker whether the window is enabled. The service worker starts the recorder only for enabled windows and excludes the local dashboard. This allows fetch/XHR/console instrumentation to observe the application rather than only the extension’s isolated context.

The page-world recorder has no privileged Chrome API access or pairing credentials. Its `window.postMessage` bridge forwards bounded incident data only. The background validates the archive and the sender's monitoring scope, queues it in IndexedDB, manages an optional masked screenshot, and delivers it to a fixed loopback destination. It cannot accept arbitrary destinations or privileged commands through the page bridge. No automatic download is used. The on-page indicator is excluded from recording.

The controller and rolling history are document-local. Reloads start a fresh controller while window consent remains active; persisted incidents survive reloads and browser restarts. The unsaved page buffer and pending page-to-worker handoff have no guaranteed unload/crash recovery. Multi-frame aggregation is not implemented. The page can modify its own main-world controller; extension output remains untrusted data and the viewer/collector validate it.

Incident screenshots use opaque overlays over form fields, marked sensitive regions, iframes, and open-shadow hosts before capture. Only visible error tabs are captured. Overlays are removed in a `finally` path and have a timeout fallback; a tab/document switch discards the image. This cannot recognize every personal detail or establish perfect masking under arbitrary page behavior.

## Viewer

Native forms, navigation buttons and dialogs keep primary controls familiar. Browser parsing happens in a worker; filtering/indexing occurs on the main thread. The inspector shows nearby events as context, without asserting causation. Reports and issue submissions do not automatically include the complete trace. Jira browser CORS restrictions can require CLI or manual export.

## Development

`pnpm dev` starts the practice recorder on 5173 and viewer/inbox on 5174. Vite middleware implements local practice fixtures and the inbox API. `pnpm local:build` builds the extension, viewer assets, and bundled Node server; `pnpm local:start` serves the built dashboard and inbox without Vite. The extension builds popup/background modules plus standalone recorder and bridge IIFEs.

See [automatic monitoring, persistence, research, and limits](LOCAL_MONITORING.md) for the local-server boundary and validation workflow.

See [PRD audit](PRD_AUDIT.md) for remaining architecture requirements and validation gaps.
