# Security

- Treat recording content as untrusted. The reader validates required structures, supported version, safe archive paths, nesting complexity, entry counts, and compressed/expanded sizes.
- Recorded HTML is escaped text in the viewer. No scripts, iframe reconstruction, or recorded code are executed.
- Only PNG/JPEG/WebP-named screenshot entries are exposed as raster images. The browser decodes the image; review it before sharing.
- Extension permissions are `scripting`, `storage`, and `alarms`, with `<all_urls>` host access to follow normal websites across an enabled window. Automatic page-start scripts remain idle until the service worker authorizes that window. There is no downloads permission.
- Only the packaged popup may enable/disable monitoring or configure pairing credentials. An isolated bridge accepts bounded incident data from the MAIN-world recorder; its messages cannot choose destinations, read the token, or request privileged commands. Monitored pages can fabricate incident content, which remains untrusted.
- Incident screenshot overlays precede capture and are removed afterward with a timeout fallback. The worker checks active tab, URL, and document identity before accepting the image. Moving/private content beyond recognized regions remains a limitation.
- The local inbox binds to loopback, checks Host/Origin headers, requires a pairing token for uploads, and validates archives before atomic disk storage. Retry IDs are deduplicated across restarts; queue and retention limits bound stored data. Pairing credentials remain in extension storage and the local data directory, never in recorded traces.
- Issue creation requires explicit confirmation. GitHub uses its fixed API host; Jira requires an HTTPS destination without embedded credentials. Tokens are supplied at execution time and never placed into recordings by the exporters.
- Replay runs a real browser against an explicitly provided target. Initial recorded routes are mapped onto that target origin. Inspect downloaded/generated code before running it.

Collector security tests and a real Chromium capture/delivery smoke test passed in the local-monitoring pass. These checks are not a completed security assessment or exhaustive adversarial acceptance. See [local implementation and limits](LOCAL_MONITORING.md) and the earlier [PRD audit](PRD_AUDIT.md).
