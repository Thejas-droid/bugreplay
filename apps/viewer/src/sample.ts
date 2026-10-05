import type { BugReplayTrace, TraceEvent } from "@bugreplay/shared";
const raw = [
  { type: "navigation.initial", timestamp: 0, to: "http://localhost:5173/checkout" },
  { type: "dom.snapshot", timestamp: 50, snapshotId: "initial", html: '<main><h1>Checkout</h1><label>Coupon<input value="SAVE20"></label><button>Apply coupon</button><button>Place order</button></main>' },
  { type: "interaction.input", timestamp: 1900, target: { testId: "coupon", selector: '[data-testid="coupon"]', name: "Coupon", role: "textbox" }, value: "SAVE20" },
  { type: "interaction.click", timestamp: 3000, target: { testId: "apply-coupon", selector: '[data-testid="apply-coupon"]', role: "button", name: "Apply coupon" } },
  { type: "network.request", timestamp: 3030, requestId: "req-coupon", method: "POST", url: "http://localhost:5173/api/coupon?token=%5BREDACTED%5D", requestHeaders: { Authorization: "[REDACTED]" } },
  { type: "network.response", timestamp: 3240, requestId: "req-coupon", method: "POST", url: "http://localhost:5173/api/coupon?token=%5BREDACTED%5D", status: 200, durationMs: 210, responseBody: '{"discount":20,"total":null}', responseHeaders: { "content-type": "application/json" } },
  { type: "application.breadcrumb", timestamp: 3290, name: "Coupon applied" },
  { type: "performance.longtask", timestamp: 4600, durationMs: 850, name: "self" },
  { type: "interaction.click", timestamp: 6200, target: { testId: "place-order", selector: '[data-testid="place-order"]', role: "button", name: "Place order" } },
  { type: "console.error", timestamp: 6240, message: "Checkout failed", severity: "error" },
  { type: "error.exception", timestamp: 6250, message: "Cannot read properties of undefined (reading 'total')", stack: "TypeError: Cannot read properties of undefined (reading 'total')\n    at placeOrder (checkout.ts:218:17)", severity: "error" },
  { type: "application.bug-marker", timestamp: 7100, name: "bug-marker", data: { description: "Checkout stopped after applying a coupon" } },
] as const;
export function sampleTrace(): BugReplayTrace {
  return {
    manifest: { traceVersion: "1.0", sessionId: "sample-checkout", project: "Checkout example", startedAt: "2026-08-17T10:00:00.000Z", durationMs: 8500, eventCount: raw.length, replayConfidence: "high", marker: { timestamp: 7100, description: "Checkout stopped after applying a coupon" }, files: { events: "events.msgpack", environment: "environment.json", privacy: "privacy.json" } },
    events: raw.map((e, index) => ({ ...e, id: `sample-${index}`, sequence: index + 1 })) as unknown as TraceEvent[],
    environment: { userAgent: "Example browser environment", browser: "Chrome", browserVersion: "141", os: "Windows", viewport: { width: 1440, height: 900 }, screen: { width: 1920, height: 1080 }, devicePixelRatio: 1.25, language: "en-US", timezone: "Asia/Kolkata", colorScheme: "light", reducedMotion: false, online: true },
    privacy: { inputValues: 1, headers: 1, queryParams: 1, jsonValues: 0, domTextNodes: 1, tokenStrings: 0, total: 4 },
    snapshots: { initial: raw[1].html },
  };
}
