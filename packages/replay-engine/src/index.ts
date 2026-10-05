import type { Page, Locator } from "@playwright/test";
import type { BugReplayTrace, TargetHint, NetworkEvent, TraceEvent } from "@bugreplay/shared";
export type ReplayFailureCode = "ELEMENT_NOT_FOUND" | "ELEMENT_AMBIGUOUS" | "ELEMENT_NOT_INTERACTABLE" | "ROUTE_MISMATCH" | "NETWORK_MOCK_MISMATCH" | "DOM_CHECKPOINT_MISMATCH" | "UNSUPPORTED_EVENT" | "REPLAY_TIMEOUT" | "EXPECTED_ERROR_NOT_REPRODUCED" | "REDACTED_INPUT_REQUIRED";
export interface ReplayOptions {
  baseUrl: string; network?: { mode: "live" | "mocked" | "hybrid"; mock?: string[] };
  timing?: "deterministic" | "original" | "accelerated"; expectFixed?: boolean; timeoutMs?: number;
  minTargetConfidence?: number; inputValues?: Record<string, string>;
}
export interface ReplayStep { sequence: number; type: string; ok: boolean; confidence: number; message: string; failureCode?: ReplayFailureCode }
export interface ReplayResult { ok: boolean; steps: ReplayStep[]; reproducedError: boolean; confidence: number; recordedErrors: string[]; replayErrors: string[]; networkFailures: string[]; warnings: string[] }
export function scoreTarget(h: TargetHint, candidate: { bugReplayId?: string; testId?: string; id?: string; role?: string; name?: string; text?: string }): number {
  let score = 0;
  if (h.bugReplayId && h.bugReplayId === candidate.bugReplayId) score += 100;
  if (h.testId && h.testId === candidate.testId) score += 90;
  if (h.id && h.id === candidate.id) score += 80;
  if (h.role && h.role === candidate.role && h.name && h.name === candidate.name) score += 70;
  if (h.textHint && candidate.text?.includes(h.textHint)) score += 25;
  return score;
}
async function resolve(page: Page, hint: TargetHint, minConfidence: number): Promise<{ locator: Locator; confidence: number; description: string }> {
  const candidates: [Locator, number, string][] = [];
  if (hint.bugReplayId) candidates.push([page.locator(`[data-bugreplay-id=${JSON.stringify(hint.bugReplayId)}]`), 1, `bugreplay-id=${hint.bugReplayId}`]);
  if (hint.testId) candidates.push([page.getByTestId(hint.testId), .95, `testid=${hint.testId}`]);
  if (hint.id) candidates.push([page.locator(`[id=${JSON.stringify(hint.id)}]`), .92, `id=${hint.id}`]);
  if (hint.selector) candidates.push([page.locator(hint.selector), .9, hint.selector]);
  if (hint.role && hint.name) candidates.push([page.getByRole(hint.role as any, { name: hint.name, exact: true }), .8, `${hint.role} “${hint.name}”`]);
  if (hint.textHint) candidates.push([page.getByText(hint.textHint, { exact: true }), .65, `text “${hint.textHint}”`]);
  if (hint.fallbackSelector) candidates.push([page.locator(hint.fallbackSelector), .55, hint.fallbackSelector]);
  let ambiguous = false; const diagnostics: string[] = [];
  for (const [locator, confidence, description] of candidates) {
    let count = 0; try { count = await locator.count(); } catch { diagnostics.push(`${description}: invalid selector`); continue; }
    diagnostics.push(`${description}: ${count} matches, confidence ${confidence}`);
    if (count > 1) ambiguous = true;
    if (count === 1 && confidence >= minConfidence) return { locator, confidence, description };
  }
  throw new Error(`${ambiguous ? "ELEMENT_AMBIGUOUS" : "ELEMENT_NOT_FOUND"}: ${diagnostics.join("; ") || "No target hints were captured"}`);
}
function routePath(value: string, base: string) { const url = new URL(value, base); return url.pathname + url.search + url.hash; }
const supportedActions = new Set(["interaction.click", "interaction.dblclick", "interaction.input", "interaction.select", "interaction.check", "interaction.keydown", "interaction.submit", "interaction.scroll", "interaction.focus", "interaction.blur", "interaction.change"]);
export async function replayTrace(page: Page, trace: BugReplayTrace, opts: ReplayOptions): Promise<ReplayResult> {
  const steps: ReplayStep[] = [], replayErrors: string[] = [], networkFailures: string[] = [], warnings: string[] = [];
  const recordedErrors = [...new Set(trace.events.filter(e => e.type.startsWith("error.") || e.type === "console.error").map((e: any) => String(e.message)))];
  const onError = (error: Error) => replayErrors.push(error.message);
  const onConsole = (message: { type(): string; text(): string }) => { if (message.type() === "error") replayErrors.push(message.text()); };
  page.on("pageerror", onError); page.on("console", onConsole);
  const timeout = opts.timeoutMs ?? 5000; let cleanup: (() => Promise<void>) | undefined;
  try {
    if (opts.expectFixed && !recordedErrors.length) throw new Error("EXPECTED_ERROR_NOT_REPRODUCED: this trace has no captured error to compare; checking a fix would be inconclusive");
    if (trace.manifest.incomplete) warnings.push("Some original events were not retained. Replay can be incomplete.");
    if (opts.network?.mode && opts.network.mode !== "live") cleanup = await installMocks(page, trace, opts.network.mock ?? ["/api/*"], opts.network.mode, networkFailures);
    const firstNav = trace.events.find(e => e.type.startsWith("navigation.")) as any;
    const initial = new URL(firstNav?.to ?? "/", opts.baseUrl), destination = new URL(opts.baseUrl);
    destination.pathname = initial.pathname; destination.search = initial.search; destination.hash = initial.hash;
    // Explicit target query options can select a safe fixture/fixed build without editing the trace.
    for (const [key, value] of new URL(opts.baseUrl).searchParams) destination.searchParams.set(key, value);
    await page.goto(destination.href, { waitUntil: "domcontentloaded", timeout });
    let previousTime = 0;
    const pendingResponses = new Set<Promise<void>>();
    const onRequest = (request: any) => { if (!["xhr", "fetch"].includes(request.resourceType())) return; const pending = request.response().then(() => {}, () => {}); pendingResponses.add(pending); void pending.finally(() => pendingResponses.delete(pending)); };
    page.on("request", onRequest);
    try {
      for (const event of trace.events.filter(e => e.type.startsWith("interaction.") || e.type === "navigation.route") as any[]) {
        try {
          if (opts.timing === "original" || opts.timing === "accelerated") { const delay = Math.min(Math.max(0, event.timestamp - previousTime), 30_000); await page.waitForTimeout(opts.timing === "accelerated" ? delay / 4 : delay); }
          previousTime = event.timestamp;
          if (event.type === "navigation.route") {
            const expected = routePath(event.to, opts.baseUrl); await page.waitForURL(url => url.pathname + url.search + url.hash === expected, { timeout });
            steps.push({ sequence: event.sequence, type: event.type, ok: true, confidence: 1, message: `Route matched ${expected}` }); continue;
          }
          if (!supportedActions.has(event.type)) throw new Error(`UNSUPPORTED_EVENT: ${event.type}`);
          // Focus and change are diagnostic when an input/select/check action already records its value.
          if (["interaction.focus", "interaction.blur", "interaction.change"].includes(event.type)) continue;
          if (event.type === "interaction.scroll") { await page.evaluate(({ x, y }) => window.scrollTo(x, y), { x: event.x ?? 0, y: event.y ?? 0 }); steps.push({ sequence: event.sequence, type: event.type, ok: true, confidence: 1, message: "Scrolled to recorded position" }); continue; }
          const { locator, confidence, description } = await resolve(page, event.target ?? {}, opts.minTargetConfidence ?? .6);
          await locator.waitFor({ state: "visible", timeout });
          if (event.type === "interaction.click") await locator.click({ timeout });
          else if (event.type === "interaction.dblclick") await locator.dblclick({ timeout });
          else if (event.type === "interaction.check") await locator.setChecked(Boolean(event.value), { timeout });
          else if (event.type === "interaction.input" || event.type === "interaction.select") {
            const replacement = opts.inputValues?.[event.target?.selector || event.target?.testId || ""];
            if (event.redacted && replacement === undefined) throw new Error("REDACTED_INPUT_REQUIRED: provide a safe replacement in inputValues; the hidden value cannot be reconstructed");
            const value = String(replacement ?? event.value ?? "");
            if (event.type === "interaction.select") await locator.selectOption(value, { timeout }); else await locator.fill(value, { timeout });
          } else if (event.type === "interaction.keydown" && event.key) await locator.press(event.key, { timeout });
          else if (event.type === "interaction.submit") await locator.evaluate((el: any) => { const form = el instanceof HTMLFormElement ? el : el.closest("form"); if (!form) throw new Error("No form found"); form.requestSubmit(); });
          steps.push({ sequence: event.sequence, type: event.type, ok: true, confidence, message: `Matched ${description}` });
          // Await API calls caused by this action, with a bounded deadline; persistent connections do not block indefinitely.
          if (pendingResponses.size) await Promise.race([Promise.all([...pendingResponses]), page.waitForTimeout(timeout)]);
          if (networkFailures.length) throw new Error(`NETWORK_MOCK_MISMATCH: ${networkFailures[networkFailures.length - 1]}`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const known = /^(ELEMENT_NOT_FOUND|ELEMENT_AMBIGUOUS|REDACTED_INPUT_REQUIRED|UNSUPPORTED_EVENT|NETWORK_MOCK_MISMATCH)/.exec(message)?.[1];
          const code = (known || (event.type === "navigation.route" ? "ROUTE_MISMATCH" : /Timeout/i.test(message) ? "REPLAY_TIMEOUT" : "ELEMENT_NOT_INTERACTABLE")) as ReplayFailureCode;
          steps.push({ sequence: event.sequence, type: event.type, ok: false, confidence: 0, message: `${message} · Current page: ${page.url()}`, failureCode: code }); break;
        }
      }
      await page.waitForTimeout(150); // Allow queued exceptions to reach Playwright before comparison.
    } finally { page.off("request", onRequest); }
  } catch (error) {
    steps.push({ sequence: 0, type: "replay.setup", ok: false, confidence: 0, message: error instanceof Error ? error.message : String(error), failureCode: "REPLAY_TIMEOUT" });
  } finally { page.off("pageerror", onError); page.off("console", onConsole); if (cleanup) await cleanup(); }
  const reproducedError = recordedErrors.some(recorded => replayErrors.some(actual => actual === recorded || actual.includes(recorded)));
  if (recordedErrors.length && !reproducedError && !opts.expectFixed) steps.push({ sequence: 0, type: "replay.comparison", ok: false, confidence: 0, message: "The original error was not captured during replay.", failureCode: "EXPECTED_ERROR_NOT_REPRODUCED" });
  const expectationPassed = opts.expectFixed ? recordedErrors.length > 0 && replayErrors.length === 0 : recordedErrors.length ? reproducedError : true;
  return { ok: expectationPassed && steps.length > 0 && steps.every(step => step.ok) && !networkFailures.length, steps, reproducedError, confidence: steps.length ? steps.reduce((sum, step) => sum + step.confidence, 0) / steps.length : 0, recordedErrors, replayErrors, networkFailures, warnings };
}
async function installMocks(page: Page, trace: BugReplayTrace, patterns: string[], mode: string, failures: string[]) {
  const bodies = new Map((trace.events.filter(e => e.type === "network.body") as NetworkEvent[]).map(e => [e.requestId, e.responseBody]));
  const responses = (trace.events.filter(e => ["network.response", "network.failed"].includes(e.type)) as NetworkEvent[]).map(e => ({ ...e, responseBody: e.responseBody ?? bodies.get(e.requestId) }));
  const queues = new Map<string, NetworkEvent[]>();
  for (const response of responses) { const key = `${response.method} ${normalize(response.url)}`; queues.set(key, [...(queues.get(key) ?? []), response]); }
  const handler = async (route: import("@playwright/test").Route) => {
    const request = route.request();
    // Documents and static assets must still load from the build under inspection.
    if (!["xhr", "fetch"].includes(request.resourceType())) { await route.continue(); return; }
    const pathname = new URL(request.url()).pathname, key = `${request.method()} ${normalize(request.url())}`;
    const shouldMock = mode === "mocked" || patterns.some(pattern => matchPattern(pathname, pattern));
    if (!shouldMock) { await route.continue(); return; }
    const queue = queues.get(key), recorded = queue?.shift();
    if (!recorded) { failures.push(`No recorded response for ${key}`); await route.abort("failed"); return; }
    if (recorded.type === "network.failed" && !recorded.status) { await route.abort("failed"); return; }
    if (recorded.responseBody === undefined) { failures.push(`Response body was not captured for ${key}. Use live mode or add a safe fixture.`); await route.abort("failed"); return; }
    const headers = Object.fromEntries(Object.entries(recorded.responseHeaders ?? {}).filter(([name, value]) => !["content-length", "content-encoding", "transfer-encoding", "set-cookie", "connection"].includes(name.toLowerCase()) && value !== "[REDACTED]"));
    await route.fulfill({ status: recorded.status ?? 200, headers, body: typeof recorded.responseBody === "string" ? recorded.responseBody : JSON.stringify(recorded.responseBody) });
  };
  await page.route("**/*", handler); return () => page.unroute("**/*", handler);
}
function normalize(value: string) {
  const url = new URL(value, "http://local");
  for (const key of [...url.searchParams.keys()]) if (/^(token|access_token|session|auth|password|secret|key)$/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); return url.pathname + (url.search ? url.search : "");
}
function matchPattern(path: string, pattern: string) {
  const regex = pattern.split("*").map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${regex}$`).test(path);
}
export function generatePlaywrightTest(trace: BugReplayTrace, name = "replays recorded bug") {
  const lines = ["import { test, expect } from '@playwright/test';", "", "// Review this starting point. Configure baseURL and supply safe replacements for hidden values.", "// Network responses and timing conditions need application-specific fixtures.", `test(${JSON.stringify(name)}, async ({ page }) => {`, "  const errors: string[] = [];", "  page.on('pageerror', error => errors.push(error.message));"];
  let previous: any;
  for (const event of trace.events as any[]) {
    if (["interaction.focus", "interaction.blur", "interaction.change"].includes(event.type)) continue;
    if (event.type === "interaction.input" && previous?.type === event.type && (event.target?.selector ?? event.target?.fallbackSelector) === (previous.target?.selector ?? previous.target?.fallbackSelector)) lines.pop();
    if (event.type === "navigation.initial") lines.push(`  await page.goto(${JSON.stringify(routePath(event.to, "http://local"))});`);
    else if (event.type === "navigation.route") lines.push(`  await page.waitForURL(url => url.pathname + url.search + url.hash === ${JSON.stringify(routePath(event.to, "http://local"))});`);
    else if (event.type === "interaction.click") lines.push(`  await ${locatorCode(event.target)}.click();`);
    else if (event.type === "interaction.dblclick") lines.push(`  await ${locatorCode(event.target)}.dblclick();`);
    else if (event.type === "interaction.input" || event.type === "interaction.select") lines.push(event.redacted ? "  // TODO: Supply a safe replacement for this hidden input before replay." : `  await ${locatorCode(event.target)}.${event.type === "interaction.select" ? "selectOption" : "fill"}(${JSON.stringify(String(event.value ?? ""))});`);
    else if (event.type === "interaction.check") lines.push(`  await ${locatorCode(event.target)}.setChecked(${Boolean(event.value)});`);
    else if (event.type === "interaction.keydown") lines.push(`  await ${locatorCode(event.target)}.press(${JSON.stringify(event.key)});`);
    else if (event.type === "interaction.scroll") lines.push(`  await page.evaluate(() => window.scrollTo(${Number(event.x) || 0}, ${Number(event.y) || 0}));`);
    previous = event;
  }
  const error = trace.events.find(e => e.type.startsWith("error.")) as any;
  if (error) lines.push(`  await expect.poll(() => errors.some(message => message.includes(${JSON.stringify(error.message)}))).toBe(true);`, "  // To check a fix, replace this assertion with a meaningful success condition and no-error assertion.");
  else lines.push("  // TODO: Add an assertion for the expected application result.");
  lines.push("});"); return lines.join("\n");
}
function locatorCode(hint: TargetHint = {}) {
  if (hint.testId) return `page.getByTestId(${JSON.stringify(hint.testId)})`;
  if (hint.role && hint.name) return `page.getByRole(${JSON.stringify(hint.role)}, { name: ${JSON.stringify(hint.name)}, exact: true })`;
  if (hint.selector || hint.fallbackSelector) return `page.locator(${JSON.stringify(hint.selector ?? hint.fallbackSelector)})`;
  return "page.locator('[data-testid=REPLACE_WITH_RECORDED_TARGET]')";
}
