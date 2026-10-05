import type { TraceEvent, EnvironmentInfo, BugReplayTrace, TargetHint, BaseEvent } from "@bugreplay/shared";
import { uid, now } from "@bugreplay/shared";
import { Redactor, type RedactionConfig } from "@bugreplay/redaction";
import { encodeTrace } from "@bugreplay/trace-format";

export type RecorderState = "IDLE" | "RECORDING" | "PAUSED" | "FINALIZING" | "COMPLETE" | "ERROR";
export interface RecorderConfig {
  project: string; redact?: RedactionConfig; buffer?: { maxDurationMs?: number; maxBytes?: number };
  capture?: { consoleLogs?: boolean; dom?: boolean; performance?: boolean; networkBodies?: "none" | "errors-only" | "all" };
  storage?: { localStorage?: { include: string[] }; sessionStorage?: { include: string[] } };
  maxEvents?: number;
  onEvent?: (event: TraceEvent) => void;
}
export interface CapturePlugin { start(context: RecorderContext): void; stop(): void }
export interface RecorderContext {
  emit(event: Omit<TraceEvent, "id" | "timestamp" | "sequence"> & Partial<Pick<BaseEvent, "timestamp">>): void;
  redactor: Redactor; sessionStart: number;
}
export class RingBuffer<T extends { timestamp: number }> {
  private rows: { value: T; size: number }[] = []; private head = 0; private bytes = 0;
  constructor(private maxDurationMs = 60_000, private maxBytes = 10_000_000) {}
  push(value: T) {
    const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    this.rows.push({ value, size }); this.bytes += size;
    const min = value.timestamp - this.maxDurationMs;
    while (this.head < this.rows.length && (this.rows[this.head]!.value.timestamp < min || this.bytes > this.maxBytes)) this.bytes -= this.rows[this.head++]!.size;
    if (this.head > 1000) { this.rows = this.rows.slice(this.head); this.head = 0; }
  }
  values() { return this.rows.slice(this.head).map(row => row.value); }
  clear() { this.rows = []; this.head = 0; this.bytes = 0; }
}
export function targetHints(el: Element): TargetHint {
  const hint: TargetHint = { tag: el.tagName, textHint: (el.textContent || "").trim().slice(0, 120) };
  const br = el.getAttribute("data-bugreplay-id"), tid = el.getAttribute("data-testid");
  if (br) { hint.bugReplayId = br; hint.selector = `[data-bugreplay-id="${CSS.escape(br)}"]`; }
  else if (tid) { hint.testId = tid; hint.selector = `[data-testid="${CSS.escape(tid)}"]`; }
  else if (el.id) { hint.id = el.id; hint.selector = `#${CSS.escape(el.id)}`; }
  hint.fallbackSelector = cssPath(el);
  const input = el as HTMLInputElement;
  const role = el.getAttribute("role") || ({ BUTTON: "button", A: "link", SELECT: "combobox", TEXTAREA: "textbox", INPUT: input.type === "checkbox" ? "checkbox" : input.type === "radio" ? "radio" : "textbox" } as Record<string, string>)[el.tagName];
  if (role) hint.role = role;
  const name = el.getAttribute("aria-label") || input.labels?.[0]?.textContent?.trim() || input.name || hint.textHint;
  if (name) hint.name = name.slice(0, 120);
  return hint;
}
function cssPath(el: Element) {
  const parts: string[] = []; let node: Element | null = el;
  while (node && parts.length < 8) {
    let part = node.tagName.toLowerCase();
    if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
    if (node.parentElement) {
      const siblings = [...node.parentElement.children].filter(x => x.tagName === node!.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
    }
    parts.unshift(part); node = node.parentElement;
  }
  return parts.join(" > ");
}
export class Recorder {
  state: RecorderState = "IDLE"; readonly redactor: Redactor;
  private plugins: CapturePlugin[] = []; private sequence = 0; private startedPerf = 0; private startedAt = "";
  private buffer: RingBuffer<TraceEvent>; private marker?: { timestamp: number; description?: string };
  private truncated = false; private providers = new Map<string, () => unknown>();
  constructor(public config: RecorderConfig) {
    this.redactor = new Redactor(config.redact); this.buffer = new RingBuffer(config.buffer?.maxDurationMs ?? Infinity, config.buffer?.maxBytes ?? 10_000_000);
  }
  use(plugin: CapturePlugin) { if (this.state !== "IDLE") throw new Error("RECORDER_ALREADY_STARTED"); this.plugins.push(plugin); return this; }
  start() {
    if (!["IDLE", "COMPLETE"].includes(this.state)) throw new Error("RECORDER_INVALID_STATE");
    this.buffer.clear(); this.redactor.reset(); this.marker = undefined; this.sequence = 0; this.truncated = false;
    this.startedPerf = now(); this.startedAt = new Date().toISOString(); this.state = "RECORDING";
    const context: RecorderContext = { emit: event => this.emit(event), redactor: this.redactor, sessionStart: this.startedPerf };
    try {
      for (const plugin of this.plugins) plugin.start(context);
      this.emit({ type: "recorder.state", state: "RECORDING" }); this.captureState();
    } catch (error) { for (const plugin of this.plugins) { try { plugin.stop(); } catch {} } this.state = "ERROR"; throw error; }
    return this;
  }
  pause() { if (this.state === "RECORDING") { this.state = "PAUSED"; this.emit({ type: "recorder.state", state: "PAUSED" }, true); } }
  resume() { if (this.state === "PAUSED") { this.state = "RECORDING"; this.emit({ type: "recorder.state", state: "RECORDING" }, true); } }
  markBug(description?: string) {
    if (!["RECORDING", "PAUSED"].includes(this.state)) throw new Error("Start recording before marking a bug.");
    this.marker = { timestamp: now() - this.startedPerf, description: description ? this.redactor.text(description.slice(0, 2000)) : undefined };
    this.emit({ type: "application.bug-marker", name: "bug-marker", data: { description: this.marker.description } }, true); this.captureState();
  }
  setContext(data: Record<string, unknown>) { this.emit({ type: "application.context", name: "context", data }); }
  breadcrumb(name: string, data?: unknown) { this.emit({ type: "application.breadcrumb", name, data }); }
  registerStateProvider(name: string, provider: () => unknown) { this.providers.set(name, provider); return () => this.providers.delete(name); }
  private captureState() {
    for (const [name, provider] of this.providers) {
      try { this.emit({ type: "application.state", name, data: provider() }); }
      catch { this.emit({ type: "recorder.state-provider-failed", severity: "warning" }); }
    }
  }
  private emit(raw: any, force = false) {
    if (!force && this.state !== "RECORDING") return;
    try {
      const event = this.redactor.event({ ...raw, id: uid("evt"), timestamp: Math.max(0, raw.timestamp ?? now() - this.startedPerf), sequence: ++this.sequence } as TraceEvent);
      this.buffer.push(event);
      if (this.sequence > (this.config.maxEvents ?? 100_000)) this.truncated = true;
      // Observers receive the redacted event. Their failures cannot affect the page.
      try { this.config.onEvent?.(event); } catch {}
    } catch { this.truncated = true; /* Instrumentation must not break the application. */ }
  }
  async stop(): Promise<{ trace: BugReplayTrace; bytes: Uint8Array }> {
    if (!["RECORDING", "PAUSED"].includes(this.state)) throw new Error("RECORDER_INVALID_STATE");
    this.emit({ type: "recorder.state", state: "COMPLETE" }, true); this.state = "FINALIZING";
    try {
      for (const plugin of this.plugins) plugin.stop();
      const trace = this.snapshot();
      const bytes = encodeTrace(trace); this.state = "COMPLETE"; return { trace, bytes };
    } catch (error) { this.state = "ERROR"; throw error; }
  }
  /** Produce an incident without stopping capture or restoring instrumented APIs. */
  snapshot(): BugReplayTrace {
      const retained = this.buffer.values();
      const events = retained.slice(-(this.config.maxEvents ?? 100_000)).map(e => this.redactor.event(e)).sort((a, b) => a.sequence - b.sequence);
      const incomplete = this.truncated || events.length < this.sequence;
      if (incomplete) events.push({ id: uid("evt"), type: "recorder.events-dropped", timestamp: now() - this.startedPerf, sequence: this.sequence + 1, severity: "warning" });
      const snapshots = Object.fromEntries(events.filter((e: any) => e.type === "dom.snapshot" && e.html).map((e: any) => [e.snapshotId, e.html]));
      const trace: BugReplayTrace = {
        manifest: { traceVersion: "1.0", sessionId: uid("session"), project: this.config.project, startedAt: this.startedAt, durationMs: now() - this.startedPerf, eventCount: events.length, replayConfidence: scoreTrace(events), marker: this.marker, incomplete, files: { events: "events.msgpack", environment: "environment.json", privacy: "privacy.json", snapshots: Object.keys(snapshots).map(id => `snapshots/${id}.html`) } },
        events, environment: environment(), privacy: { ...this.redactor.summary }, snapshots,
      };
      return trace;
  }
  getEvents() { return this.buffer.values(); }
}
export function environment(): EnvironmentInfo {
  const ua = navigator.userAgent, browser = /(Edg|Firefox|Chrome|Version)\/([\d.]+)/.exec(ua);
  return { userAgent: ua, browser: browser ? ({ Edg: "Edge", Version: "Safari" } as Record<string, string>)[browser[1]!] ?? browser[1] : undefined, browserVersion: browser?.[2], os: /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : undefined,
    viewport: { width: innerWidth, height: innerHeight }, screen: { width: screen.width, height: screen.height }, devicePixelRatio, language: navigator.language, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    colorScheme: matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light", reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches, online: navigator.onLine, hardwareConcurrency: navigator.hardwareConcurrency };
}
function scoreTrace(events: TraceEvent[]) {
  const actions = events.filter(e => ["interaction.click", "interaction.input", "interaction.select", "interaction.check", "interaction.keydown"].includes(e.type)) as any[];
  if (!actions.length) return "unsupported" as const;
  const ratio = actions.filter(e => e.target?.selector || (e.target?.role && e.target?.name)).length / actions.length;
  const score = Math.max(0, ratio - (actions.some(e => e.redacted) ? .3 : 0) - (events.some(e => e.type === "recorder.events-dropped") ? .25 : 0));
  return score >= .85 ? "high" as const : score >= .6 ? "medium" as const : "low" as const;
}
export function browserCapturePlugins(config: RecorderConfig): CapturePlugin[] {
  return [interactionPlugin(), navigationPlugin(), consolePlugin(!!config.capture?.consoleLogs), errorPlugin(), networkPlugin(config.capture?.networkBodies ?? "none"), xhrPlugin(), storagePlugin(config), ...(config.capture?.performance === false ? [] : [performancePlugin()]), ...(config.capture?.dom === false ? [] : [domPlugin()])];
}
function interactionPlugin(): CapturePlugin {
  let off: (() => void)[] = [];
  return { start(c) {
    const on = (type: string, fn: (event: any) => void) => { addEventListener(type, fn, true); off.push(() => removeEventListener(type, fn, true)); };
    for (const type of ["click", "dblclick", "submit", "focus", "blur", "change", "input"]) on(type, event => {
      const el = (event.composedPath?.()[0] ?? event.target) as Element;
      if (!(el instanceof Element) || el.closest("[data-bugreplay-ignore]")) return;
      const input = el as HTMLInputElement;
      const target = targetHints(el);
      if (c.redactor.isSensitive(el)) { target.textHint = "[REDACTED]"; target.name = "Sensitive field"; }
      let value: unknown; let redacted = false; let kind = type;
      if (type === "input") { const result = c.redactor.input(input.value ?? el.textContent ?? "", el); value = result.value; redacted = result.redacted; }
      if (type === "change" && el.tagName === "SELECT") { kind = "select"; const result = c.redactor.input(input.value, el); value = result.value; redacted = result.redacted; }
      if (type === "change" && ["checkbox", "radio"].includes(input.type)) { kind = "check"; value = input.checked; }
      c.emit({ type: `interaction.${kind}`, target, value, redacted, pointer: event instanceof MouseEvent ? { x: event.clientX, y: event.clientY, button: event.button } : undefined } as any);
    });
    on("keydown", event => {
      if (["Enter", "Escape", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key) && event.target instanceof Element && !event.target.closest("[data-bugreplay-ignore]")) c.emit({ type: "interaction.keydown", key: event.key, target: targetHints(event.target) } as any);
    });
    let timer: ReturnType<typeof setTimeout>;
    on("scroll", () => { clearTimeout(timer); timer = setTimeout(() => c.emit({ type: "interaction.scroll", x: scrollX, y: scrollY } as any), 150); });
    off.push(() => clearTimeout(timer));
  }, stop() { off.forEach(fn => fn()); off = []; } };
}
function navigationPlugin(): CapturePlugin {
  let restore: (() => void)[] = [];
  return { start(c) {
    let previous = location.href;
    const emit = () => { if (location.href !== previous) { c.emit({ type: "navigation.route", from: previous, to: location.href } as any); previous = location.href; } };
    for (const name of ["pushState", "replaceState"] as const) {
      const original = history[name]; history[name] = function (this: History, ...args) { const result = original.apply(this, args); queueMicrotask(emit); return result; };
      restore.push(() => { history[name] = original; });
    }
    addEventListener("popstate", emit); addEventListener("hashchange", emit);
    restore.push(() => { removeEventListener("popstate", emit); removeEventListener("hashchange", emit); });
    c.emit({ type: "navigation.initial", to: location.href } as any);
  }, stop() { restore.forEach(fn => fn()); restore = []; } };
}
function consolePlugin(logs: boolean): CapturePlugin {
  const methods: (keyof Pick<Console, "error" | "warn" | "log" | "info" | "debug">)[] = logs ? ["error", "warn", "log", "info", "debug"] : ["error", "warn"];
  let restore: (() => void)[] = [];
  return { start(c) { for (const method of methods) {
    const original = console[method]; console[method] = (...args: unknown[]) => {
      try { const safe = c.redactor.value(args) as unknown[]; c.emit({ type: `console.${method}`, message: safe.map(a => typeof a === "string" ? a : JSON.stringify(a)).join(" ").slice(0, 4000), args: safe, severity: method === "error" ? "error" : method === "warn" ? "warning" : "info" } as any); } catch {}
      original.apply(console, args);
    }; restore.push(() => { console[method] = original; });
  } }, stop() { restore.forEach(fn => fn()); restore = []; } };
}
function errorPlugin(): CapturePlugin {
  let error: (event: ErrorEvent) => void, rejection: (event: PromiseRejectionEvent) => void;
  return { start(c) {
    error = event => {
      if (event.message) c.emit({ type: "error.exception", message: event.message, stack: event.error?.stack, source: event.filename, line: event.lineno, column: event.colno, severity: "error" } as any);
      else if (event.target instanceof Element) {
        const target = event.target as HTMLImageElement;
        c.emit({ type: "error.resource-load", message: `Failed to load ${target.tagName.toLowerCase()} resource`, source: target.getAttribute("src") || target.getAttribute("href") || undefined, severity: "error" } as any);
      }
    };
    rejection = event => c.emit({ type: "error.unhandled-rejection", message: String(event.reason?.message ?? event.reason), stack: event.reason?.stack, severity: "error" } as any);
    addEventListener("error", error, true); addEventListener("unhandledrejection", rejection);
  }, stop() { removeEventListener("error", error, true); removeEventListener("unhandledrejection", rejection); } };
}
function networkPlugin(mode: string): CapturePlugin {
  let original: typeof fetch; let active = false;
  return { start(c) {
    original = window.fetch; active = true;
    window.fetch = async (input, init) => {
      const request = input instanceof Request ? input : undefined;
      const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
      const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
      const requestId = uid("req"), started = now();
      c.emit({ type: "network.request", requestId, method, url, requestHeaders: headersToObj(init?.headers ?? request?.headers), requestBody: mode === "all" && typeof init?.body === "string" ? init.body.slice(0, 64000) : undefined } as any);
      try {
        const response = await original.call(window, input, init);
        const ok = response.status >= 200 && response.status < 400;
        const metadata = { requestId, method, url, status: response.status, durationMs: now() - started, responseHeaders: headersToObj(response.headers), severity: ok ? "info" : "error" };
        if (active) c.emit({ type: ok ? "network.response" : "network.failed", ...metadata } as any);
        if (mode === "all" || (mode === "errors-only" && !ok)) {
          // Preserve response metadata immediately; an optional body is a separate update.
          void boundedBody(response.clone()).then(responseBody => { if (active) c.emit({ type: "network.body", ...metadata, responseBody } as any); }, () => {});
        }
        return response;
      } catch (error: any) {
        if (active) c.emit({ type: "network.failed", requestId, method, url, durationMs: now() - started, error: String(error?.message ?? error), severity: "error" } as any);
        throw error;
      }
    };
  }, stop() { active = false; if (original) window.fetch = original; } };
}
async function boundedBody(response: Response) {
  const reader = response.body?.getReader(); if (!reader) return "";
  const chunks: Uint8Array[] = []; let total = 0;
  try { while (total < 64_000) { const { value, done } = await reader.read(); if (done) break; const chunk = value.slice(0, 64_000 - total); chunks.push(chunk); total += chunk.length; } }
  finally { await reader.cancel(); }
  const bytes = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}
function headersToObj(headers?: HeadersInit) { return headers ? Object.fromEntries(new Headers(headers).entries()) : {}; }
function xhrPlugin(): CapturePlugin {
  let restore: (() => void)[] = []; let active = false;
  return { start(c) {
    active = true; const proto = XMLHttpRequest.prototype, originalOpen = proto.open, originalSend = proto.send;
    const metadata = new WeakMap<XMLHttpRequest, { method: string; url: string }>();
    proto.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
      metadata.set(this, { method: method.toUpperCase(), url: String(url) });
      return (originalOpen as any).call(this, method, url, ...rest);
    } as typeof proto.open;
    proto.send = function (body) {
      const meta = metadata.get(this); if (!meta) return originalSend.call(this, body);
      const requestId = uid("req"), started = now();
      c.emit({ type: "network.request", requestId, ...meta, resourceType: "xhr" } as any);
      this.addEventListener("loadend", () => { if (active) c.emit({ type: this.status >= 200 && this.status < 400 ? "network.response" : "network.failed", requestId, ...meta, status: this.status || undefined, error: this.status === 0 ? "Request failed, timed out, or was aborted" : undefined, durationMs: now() - started, resourceType: "xhr", severity: this.status >= 200 && this.status < 400 ? "info" : "error" } as any); }, { once: true });
      return originalSend.call(this, body);
    };
    restore.push(() => { proto.open = originalOpen; proto.send = originalSend; });
  }, stop() { active = false; restore.forEach(fn => fn()); restore = []; } };
}
function storagePlugin(config: RecorderConfig): CapturePlugin {
  return { start(c) {
    for (const name of ["localStorage", "sessionStorage"] as const) {
      try {
        const storage = window[name], include = config.storage?.[name]?.include ?? [], data: Record<string, unknown> = {};
        for (let index = 0; index < Math.min(storage.length, 200); index++) { const key = storage.key(index)!; data[key] = include.includes(key) && !/token|auth|secret|password|session/i.test(key) ? storage.getItem(key) : "[VALUE_NOT_CAPTURED]"; }
        c.emit({ type: "storage.snapshot", name, data } as any);
      } catch { c.emit({ type: "recorder.storage-unavailable", severity: "warning" }); }
    }
  }, stop() {} };
}
function performancePlugin(): CapturePlugin {
  let observers: PerformanceObserver[] = [];
  return { start(c) {
    for (const type of ["longtask", "layout-shift", "largest-contentful-paint", "paint", "navigation", "resource"]) {
      try {
        const observer = new PerformanceObserver(list => { for (const entry of list.getEntries() as any[]) {
          if (entry.startTime < c.sessionStart && type !== "navigation") continue;
          c.emit({ type: `performance.${type}`, timestamp: Math.max(0, entry.startTime - c.sessionStart), durationMs: entry.duration, value: entry.value, name: type === "resource" || type === "navigation" ? c.redactor.url(entry.name) : entry.name, data: type === "layout-shift" ? { hadRecentInput: entry.hadRecentInput } : undefined } as any);
        } }); observer.observe({ type, buffered: true }); observers.push(observer);
      } catch { /* Unsupported performance APIs are optional. */ }
    }
  }, stop() { observers.forEach(observer => observer.disconnect()); observers = []; } };
}
function domPlugin(): CapturePlugin {
  let observer: MutationObserver | undefined; let timer: ReturnType<typeof setTimeout> | undefined; let flush: (() => void) | undefined;
  return { start(c) {
    const snapshot = (id: string) => { if (document.documentElement) c.emit({ type: "dom.snapshot", snapshotId: id, html: c.redactor.snapshot(document.documentElement) } as any); };
    snapshot("initial"); let pending: unknown[] = [];
    flush = () => { timer = undefined; if (pending.length) c.emit({ type: "dom.mutations", mutations: pending.splice(0) } as any); };
    observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        const el = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (!el || el.closest("[data-bugreplay-ignore],script,style,noscript") || c.redactor.isSensitive(el)) continue;
        if (pending.length < 200) pending.push({ type: mutation.type, target: { selector: targetHints(el).selector, fallbackSelector: targetHints(el).fallbackSelector, tag: el.tagName }, attributeName: mutation.attributeName, added: mutation.addedNodes.length, removed: mutation.removedNodes.length });
      }
      if (!timer) timer = setTimeout(flush!, 16);
    });
    if (document.documentElement) observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }, stop() { observer?.disconnect(); if (timer) clearTimeout(timer); timer = undefined; flush = undefined; } };
}
