# Trace format v1.0

`.bugreplay` is a ZIP-compatible archive containing `manifest.json`, `events.msgpack`, `environment.json`, `privacy.json`, plus optional `snapshots/` and `screenshots/`. Readers reject unknown versions and enforce archive/entry limits. Events use monotonically increasing `sequence` for deterministic ordering; relative times are recorded from `performance.now()`.

Optional fetch body completion is stored as a `network.body` event linked to its request ID. Metadata responses are recorded immediately so stopping before body completion does not discard the entire response. The viewer and mock runner associate captured body updates with that request. A body update may be absent if capture stopped before it completed.

File decoding uses a viewer worker. Expanded archive bytes, entry sizes/counts, path names, required event fields, and nesting complexity are bounded. Unknown versions receive an explicit error; a version migration mechanism is not yet implemented.
