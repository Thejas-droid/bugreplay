# Privacy and redaction

Capture is explicitly enabled per browser window and remains local. While enabled, website errors trigger automatic captures and silent transfers to the paired dashboard on your computer. Redaction masks password/hidden inputs, marked or configured selectors, sensitive headers/query parameters/JSON keys, common token/card patterns, and optional email/phone patterns. DOM capture clones the page, removes executable content and ignored nodes, and masks configured regions/attributes before retention. Console serialization has depth, entry and circular-reference limits. Fetch bodies are bounded; XHR captures metadata only.

Each recording resets its privacy counts. Counts reflect applied rules across capture/finalization and are not a measure of unique secrets or proof that every private value is absent. Arbitrary names, addresses, business data, or unusual secrets can remain. Inspect the recording and report before sharing.

The extension defaults to no response-body capture. The practice app enables bodies because its APIs contain local fake fixture data. Optional screenshots mask standard regions before capture; inspect images separately for remaining personal content.

`pnpm cli sanitize trace.bugreplay` applies another conservative pass, masks email/phone patterns, and writes a new file. It omits DOM events/snapshots and screenshots because their original live-page masking cannot be re-established offline. Sanitization preserves the original recording unless a separate output path is supplied. This can reduce replay/diagnostic fidelity.

Export tokens are not included in recordings. The viewer keeps a token in component memory and clears it after a submission attempt; CLI integrations read environment variables. No keychain integration is implemented. Sending a report requires explicit action and destination confirmation; the recording itself must be attached separately.

The current unit and Chromium smoke tests check redacted observer/archive data and screenshot collection on a controlled fixture. They do not establish complete secret-exclusion coverage or exhaustive screenshot/adversarial privacy acceptance. See [local storage, capture limits, and screenshot settings](LOCAL_MONITORING.md).
