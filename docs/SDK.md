# Browser SDK

Connect recording to explicit controls and display the recording state to the person using the application.

```ts
import { BugReplay } from '@bugreplay/browser';

BugReplay.init({
  project: 'checkout',
  redact: { selectors: ['[data-sensitive]'], maskEmails: true },
  capture: { dom: true, performance: true, networkBodies: 'none' },
  // Optional rolling retention; otherwise duration is unbounded and bytes are capped.
  buffer: { maxDurationMs: 60_000, maxBytes: 10_000_000 },
  storage: { localStorage: { include: ['theme'] } },
});

BugReplay.registerStateProvider('cart', () => ({ itemCount: 4 }));
BugReplay.start();
BugReplay.setContext({ featureFlags: { newCheckout: true } });
BugReplay.breadcrumb('coupon_applied', { kind: 'seasonal' });
BugReplay.pause();
BugReplay.resume();
BugReplay.markBug('Place order failed');
await BugReplay.stop(); // Downloads a .bugreplay file by default.
```

`stop({ download: false })` returns `{ trace, bytes }` for local application handling. After completion, `start()` creates a new clean session. Do not reinitialize during an active recording. Custom plugins implement `start(context)` and `stop()`; the core remains independent of React.

Storage captures keys by default. Only allowlisted, non-secret-like keys may include values. Do not expose auth/payment/state secrets through custom context or state providers. Provider output is bounded and redacted, but arbitrary personal information cannot be recognized automatically.

Fetch modes are `none`, `errors-only`, and `all`; bodies have a 64 KB reader cap. XHR currently captures metadata only. There is no automatic error-triggered recording, screenshot capture, React provider or router-specific adapter in this SDK. See the [PRD audit](PRD_AUDIT.md).
