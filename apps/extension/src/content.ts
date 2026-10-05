import { encodeTrace } from "@bugreplay/trace-format";
import type { BugReplayTrace, TraceEvent } from "@bugreplay/shared";
import { Recorder, browserCapturePlugins, type RecorderConfig } from "@bugreplay/recorder-core";

// This MAIN-world module can observe page APIs but has no Chrome APIs or secrets.
const scope = window as any;
if (!scope.__bugreplayExtension) {
  let recorder: Recorder | undefined;
  let masks: HTMLDivElement | undefined;
  let indicator: HTMLDivElement | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let dirty = false, firstProblemAt = 0, lastCapture = 0;
  let pending: { id: string; bytes: number[] } | undefined;
  let lastSent = 0;
  function observe(event: TraceEvent) {
    if (event.type.startsWith("error.") || event.type === "console.error" || event.type === "network.failed" || (event.type.startsWith("network.") && event.severity === "error")) {
      if (!dirty) firstProblemAt = Date.now();
      dirty = true;
    }
  }
  function tick(force = false) {
    if (!recorder || recorder.state !== "RECORDING") return;
    try {
      if (!pending && dirty && (force || (Date.now() - firstProblemAt >= 1000 && Date.now() - lastCapture >= 10_000))) {
        const problem = [...recorder.getEvents()].reverse().find(event => event.severity === "error") as any;
        recorder.markBug(String(problem?.message || problem?.error || (problem?.status ? `HTTP ${problem.status}: ${problem.url}` : "Automatically detected error")).slice(0, 2000));
        recorder.breadcrumb("capture-page", { url: location.href });
        const trace: BugReplayTrace = recorder.snapshot();
        // A fresh, redacted page snapshot remains useful after the rolling buffer
        // has evicted its initial snapshot. It is diagnostic, not video replay.
        if (document.documentElement) {
          const html = recorder.redactor.snapshot(document.documentElement);
          trace.snapshots = { ...trace.snapshots, incident: html };
          trace.manifest.files.snapshots = Object.keys(trace.snapshots).map(id => `snapshots/${id}.html`);
          trace.privacy = { ...recorder.redactor.summary };
        }
        pending = { id: trace.manifest.sessionId, bytes: Array.from(encodeTrace(trace)) };
        dirty = false; lastCapture = Date.now();
      }
      if (pending && (force || Date.now() - lastSent >= 5000)) {
        lastSent = Date.now();
        window.postMessage({ source: "bugreplay-recorder", type: "INCIDENT", ...pending }, location.origin);
      }
    } catch { if (indicator) indicator.textContent = "BugReplay · capture failed; check extension"; }
  }
  window.addEventListener("message", event => {
    if (event.source === window && event.data?.source === "bugreplay-bridge" && event.data?.type === "ACK" && event.data.id === pending?.id && event.data.ok) pending = undefined;
  });
  addEventListener("pagehide", () => tick(true));
  scope.__bugreplayExtension = {
    async command(type: string) {
      if (type === "MASK_SCREENSHOT") {
        if (!recorder || !["RECORDING", "PAUSED"].includes(recorder.state)) throw new Error("Start a recording before including a screenshot.");
        masks?.remove(); masks = document.createElement("div"); masks.setAttribute("data-bugreplay-ignore", "");
        masks.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none";
        const candidates = new Set<Element>(document.querySelectorAll('input,textarea,select,iframe,[data-sensitive],[data-bugreplay-redact]'));
        for (const host of document.querySelectorAll('*')) if (host.shadowRoot) candidates.add(host);
        for (const node of candidates) {
          const rect = node.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
          const mask = document.createElement("div");
          mask.style.cssText = `position:absolute;left:${rect.left - 2}px;top:${rect.top - 2}px;width:${rect.width + 4}px;height:${rect.height + 4}px;background:#25372b;opacity:1;border-radius:3px`;
          masks.append(mask);
        }
        document.documentElement.append(masks);
        const applied = masks; setTimeout(() => { applied.remove(); }, 2500);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      }
      if (type === "UNMASK_SCREENSHOT") { masks?.remove(); masks = undefined; }
      if (type === "START") {
        if (recorder?.state === "RECORDING") return;
        const config: RecorderConfig = { project: location.hostname || "Browser recording", redact: { maskEmails: true }, capture: { dom: true, performance: true, networkBodies: "none" }, buffer: { maxDurationMs: 60_000, maxBytes: 5_000_000 }, maxEvents: 20_000, onEvent: observe };
        recorder = new Recorder(config); for (const plugin of browserCapturePlugins(config)) recorder.use(plugin);
        dirty = false; pending = undefined; lastCapture = 0; lastSent = 0;
        indicator = document.createElement("div"); indicator.setAttribute("data-bugreplay-ignore", "");
        indicator.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;padding:8px 12px;border-radius:8px;background:#225b43;color:white;font:12px system-ui;pointer-events:none";
        indicator.textContent = "● BugReplay · monitoring";
        document.documentElement?.append(indicator); recorder.start();
        if (!document.documentElement) document.addEventListener("DOMContentLoaded", () => { if (recorder?.state === "RECORDING" && indicator) document.documentElement.append(indicator); }, { once: true });
        timer = setInterval(tick, 1000);
      }
      if (type === "STOP") {
        tick(true);
        if (timer) clearInterval(timer); timer = undefined;
        if (recorder?.state === "RECORDING") await recorder.stop();
        indicator?.remove(); masks?.remove();
      }
      return { state: recorder?.state ?? "IDLE" };
    },
  };
}
