# Replay semantics

Replay is a CLI operation backed by Playwright, separate from opening a recording in the viewer. The confidence label in the viewer is an estimate of recorded target coverage and known missing data; it is not proof of deterministic reproduction.

```bash
pnpm --filter @bugreplay/cli exec playwright install chromium
pnpm cli replay trace.bugreplay --base-url http://localhost:5173
```

## Actions and targets

Stable BugReplay IDs, test IDs, element IDs, exact selectors, exact role/name, exact text, and structural selectors are tried in confidence order. Only unique matches at or above the configured threshold are selected. Ambiguous or missing targets produce diagnostic failures. Weak structural fallback can fall below the threshold instead of clicking an arbitrary element.

Click/double click, fill, select, check, important keys, submit, scroll, and expected SPA routes have replay paths. Focus/blur and ordinary change are diagnostic; unsupported actions do not silently pass. Redacted values require safe replacements:

```bash
pnpm cli replay trace.bugreplay --base-url http://localhost:5173 --input-values safe-values.json
```

`safe-values.json` maps recorded selectors (or test IDs when no selector exists) to strings. Keep fixture secrets outside the trace and do not publish that file.

## Network modes

- `live` is the CLI default: use the current backend.
- `hybrid` mocks matching API paths (default `/api/*`); use `--mock` for comma-separated patterns.
- `mocked` mocks fetch/XHR requests while documents and static assets load from the target build.

Response queues match method + normalized URL + recorded order. Sensitive query parameters are excluded and the remaining parameters are sorted. Request body hashes and causality-based matching remain incomplete. A missing response/body fails rather than synthesizing a successful empty response. A recorded browser failure is reproduced by aborting the request. Compression/length/cookie headers are excluded from fulfilled fixtures.

## Timing and results

`--timing deterministic` uses Playwright action readiness, route expectations and bounded API-response waits. Original/accelerated modes additionally preserve or shorten recorded gaps. These do not implement full application-idle or DOM-checkpoint determinism.

`--repeat 5` uses a fresh browser context per run and reports pass ratio. `--out result.json` writes diagnostics. `--expect-fixed` requires an original captured error, completion of all replayed actions, and no replay errors. It does not prove all business requirements; add explicit success assertions to your own regression test.

Generated Playwright files are starting points. Review hidden values, unsupported actions, API fixtures, timing, and the expected business result. Runtime acceptance was not performed during the current improvement pass.

For the practice runtime error, target `http://localhost:5173?fixed=1` with `--expect-fixed`. Explicit target query options override recorded options at initial navigation. This is a fixture switch, not a source-code repair of an actual production checkout.
