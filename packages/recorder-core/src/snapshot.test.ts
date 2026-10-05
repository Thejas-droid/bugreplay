import { afterEach, expect, it, vi } from "vitest";
import { Recorder, type RecorderContext } from "./index";
function browserEnvironment() {
  for (const [key, value] of Object.entries({ navigator: { userAgent: "Chrome/130", language: "en", onLine: true }, innerWidth: 1280, innerHeight: 720, screen: { width: 1280, height: 720 }, devicePixelRatio: 1, matchMedia: () => ({ matches: false }) })) vi.stubGlobal(key, value);
}
afterEach(() => vi.unstubAllGlobals());
it("snapshots errors without stopping capture and redacts observer data", async () => {
  browserEnvironment(); let context: RecorderContext | undefined; const stop = vi.fn(); const observer = vi.fn();
  const recorder = new Recorder({ project: "test", redact: { maskEmails: true }, onEvent: observer });
  recorder.use({ start(value) { context = value; }, stop }); recorder.start();
  context!.emit({ type: "error.exception", message: "Failure for test@example.com", severity: "error" } as any);
  const first = recorder.snapshot();
  expect(recorder.state).toBe("RECORDING"); expect(stop).not.toHaveBeenCalled();
  expect(JSON.stringify(first)).not.toContain("test@example.com"); expect(JSON.stringify(observer.mock.calls)).not.toContain("test@example.com");
  context!.emit({ type: "error.exception", message: "second failure", severity: "error" } as any);
  const second = recorder.snapshot();
  expect(second.manifest.sessionId).not.toBe(first.manifest.sessionId); expect(second.events.length).toBeGreaterThan(first.events.length);
  expect((await recorder.stop()).trace.events.some((event: any) => event.message === "second failure")).toBe(true);
  expect(stop).toHaveBeenCalledTimes(1);
});
it("continues recording when an incident observer throws", async () => {
  browserEnvironment();
  const recorder = new Recorder({ project: "test", onEvent() { throw new Error("observer failed"); } });
  recorder.start(); recorder.breadcrumb("still recording");
  expect(recorder.getEvents()).toHaveLength(2); await recorder.stop();
});
