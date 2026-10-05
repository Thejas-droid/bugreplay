import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { decodeTrace } from "../packages/trace-format/src/index";

process.chdir(resolve(dirname(process.argv[1]!), ".."));
const require = createRequire(resolve("apps/replay-cli/package.json"));
const { chromium } = require("@playwright/test");
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until<T>(check: () => Promise<T>, label: string, timeout = 20_000): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await check().catch(() => undefined); if (result) return result; await sleep(250); }
  throw new Error(`Timed out: ${label}`);
}
async function main() {
  // Never reuse an occupied dashboard port or touch existing user recordings.
  try { await fetch("http://127.0.0.1:5174"); throw new Error("Stop the dashboard on port 5174 before running the smoke test."); }
  catch (error: any) { if (!/fetch failed/.test(error.message)) throw error; }
  const temporary = await mkdtemp(join(tmpdir(), "bugreplay-extension-smoke-"));
  let collector: ChildProcess | undefined; let context: any;
  const fixture = createServer((req, res) => {
    if (req.url === "/failure" || req.url === "/missing.png") { res.statusCode = 500; res.end("Test failure"); return; }
    if (req.url === "/favicon.ico") { res.statusCode = 204; res.end(); return; }
    res.setHeader("Content-Type", "text/html");
    res.end(`<!doctype html><html><body><h1>Real extension fixture</h1><input type="password" value="secret-never-share"><button id="runtime" onclick="throw new Error('runtime smoke failure')">Runtime error</button><button id="console" onclick="console.error('console smoke failure')">Console error</button><button id="rejection" onclick="Promise.reject(new Error('rejection smoke failure'))">Rejection</button><button id="network" onclick="fetch('/failure')">HTTP error</button><button id="resource" onclick="const img = new Image();img.src='/missing.png';document.body.append(img)">Resource error</button></body></html>`);
  });
  const localHeaders = { "X-BugReplay-Local": "1" };
  const rows = async () => (await fetch("http://127.0.0.1:5174/api/local/incidents", { headers: localHeaders })).json();
  function startCollector() { collector = spawn(process.execPath, [resolve("apps/viewer/server-dist/server.js")], { env: { ...process.env, BUGREPLAY_DATA_DIR: join(temporary, "data") }, stdio: ["ignore", "pipe", "pipe"] }); }
  async function stopCollector() { if (collector) { const processToStop = collector; await new Promise<void>(resolve => { processToStop.once("exit", () => resolve()); processToStop.kill(); }); collector = undefined; } }
  try {
    await new Promise<void>((resolve, reject) => { fixture.once("error", reject); fixture.listen(0, "127.0.0.1", resolve); });
    const fixtureUrl = `http://127.0.0.1:${(fixture.address() as any).port}`;
    startCollector();
    const config = await until(async () => { const response = await fetch("http://127.0.0.1:5174/api/local", { headers: localHeaders }); return response.ok && response.json(); }, "collector startup");
    const extension = resolve("apps/extension/dist");
    context = await chromium.launchPersistentContext(join(temporary, "profile"), { channel: "chromium", headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, "--no-sandbox"] });
    let worker = context.serviceWorkers()[0]; if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage(); await page.goto(fixtureUrl);
    const popup = await context.newPage(); await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByLabel("Dashboard pairing token").fill(config.token);
    await popup.getByRole("button", { name: "Turn monitoring on" }).click();
    await popup.getByRole("button", { name: "Turn monitoring off" }).waitFor();
    await page.bringToFront();
    await page.waitForFunction(() => (window as any).__bugreplayExtension?.command("STATUS").then((value: any) => value.state === "RECORDING"));
    let downloads = 0; page.on("download", () => downloads++);
    await page.locator("#runtime").click();
    const first = await until(async () => { const items = await rows(); return items.length && items; }, "automatic error delivery");
    assert.equal(first.length, 1); assert.equal(first[0].screenshot, true);
    const archive = await fetch(`http://127.0.0.1:5174/api/local/incidents/${first[0].id}`, { headers: localHeaders });
    const trace = decodeTrace(new Uint8Array(await archive.arrayBuffer()));
    assert(trace.events.some((event: any) => event.type === "error.exception" && event.message.includes("runtime smoke failure")));
    assert(Object.keys(trace.screenshots || {}).length === 1);
    assert(!JSON.stringify(trace.events).includes("secret-never-share")); assert(!JSON.stringify(trace.snapshots).includes("secret-never-share"));
    console.log("PASS automatic runtime capture, screenshot, redaction, and silent delivery");
    await stopCollector();
    await page.reload(); await page.waitForFunction(() => (window as any).__bugreplayExtension?.command("STATUS").then((value: any) => value.state === "RECORDING"));
    await page.locator("#console").click(); await page.locator("#rejection").click(); await page.locator("#network").click(); await page.locator("#resource").click();
    await until(async () => { await popup.bringToFront(); const result = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "STATUS" })); return result.pending > 0; }, "offline queue persistence");
    console.log("PASS reload resumes monitoring and offline incident is queued");
    startCollector(); await until(async () => (await fetch("http://127.0.0.1:5174/api/local", { headers: localHeaders })).ok, "collector restart");
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: "RETRY" }));
    const delivered = await until(async () => { const items = await rows(); return items.length >= 2 && items; }, "retry delivery");
    const latest = await fetch(`http://127.0.0.1:5174/api/local/incidents/${delivered[0].id}`, { headers: localHeaders });
    const second = decodeTrace(new Uint8Array(await latest.arrayBuffer()));
    for (const type of ["console.error", "error.unhandled-rejection", "network.failed", "error.resource-load"]) assert(second.events.some(event => event.type === type), `Missing ${type}`);
    assert(second.events.some((event: any) => event.type === "network.failed" && event.status === 500));
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: "RETRY" })); assert.equal((await rows()).length, 2);
    console.log("PASS console/rejection/HTTP/resource errors, restart, retry, and deduplication");
    const newTab = await context.newPage(); await newTab.goto(fixtureUrl); await newTab.waitForFunction(() => (window as any).__bugreplayExtension?.command("STATUS").then((value: any) => value.state === "RECORDING"));
    await newTab.locator("#runtime").click(); await until(async () => (await rows()).length === 3, "new tab capture");
    await popup.evaluate(() => chrome.runtime.sendMessage({ type: "DISABLE" }));
    await newTab.locator("#runtime").click(); await sleep(3000); assert.equal((await rows()).length, 3); assert.equal(downloads, 0);
    const dashboard = await context.newPage(); await dashboard.goto("http://127.0.0.1:5174");
    await dashboard.getByRole("heading", { name: "Local incident inbox" }).waitFor();
    await dashboard.locator(".incident-open").first().click(); await dashboard.getByRole("button", { name: "← Incident inbox" }).waitFor();
    console.log("PASS new tabs, monitoring off, zero downloads, and dashboard opens stored incident");
  } finally { if (context) await context.close(); await stopCollector(); await new Promise<void>(resolve => fixture.close(() => resolve())); await rm(temporary, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
