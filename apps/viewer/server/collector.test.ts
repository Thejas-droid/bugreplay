import { afterEach, beforeEach, expect, it } from "vitest";
import { createServer, request as httpRequest, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCollector } from "./collector";
import { sampleTrace } from "../src/sample";
import { encodeTrace, decodeTrace } from "@bugreplay/trace-format";

let directory: string, base: string, server: Server;
// node:http preserves explicit Host headers, unlike Node's fetch implementation.
const fetch = (url: string, options: { method?: string; headers?: Record<string, string>; body?: BodyInit } = {}) => new Promise<Response>((resolve, reject) => {
  const request = httpRequest(url, { method: options.method, headers: options.headers }, response => {
    const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(Buffer.from(chunk)));
    response.on("end", () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode || 500 })));
  });
  request.on("error", reject); request.end(options.body);
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "bugreplay-collector-"));
  const collector = createCollector(directory);
  server = createServer((req, res) => void collector(req, res, () => { res.statusCode = 404; res.end(); }));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async () => { await new Promise<void>(resolve => server.close(() => resolve())); await rm(directory, { recursive: true, force: true }); });
const dashboardHeaders = { Host: "localhost:5174", "X-BugReplay-Local": "1" };
async function token() { return (await (await fetch(`${base}/api/local`, { headers: dashboardHeaders })).json()).token as string; }
async function upload(pairing: string, bytes = encodeTrace(sampleTrace())) {
  return fetch(`${base}/api/local/incidents`, { method: "POST", headers: { Host: "localhost:5174", Origin: `chrome-extension://${"a".repeat(32)}`, Authorization: `Bearer ${pairing}`, "Content-Type": "application/vnd.bugreplay+zip" }, body: bytes as unknown as BodyInit });
}
it("stores automatic incidents, deduplicates delivery retries, and opens the exact archive", async () => {
  const pairing = await token(); const bytes = encodeTrace(sampleTrace());
  expect((await upload(pairing, bytes)).status).toBe(201);
  const response = await upload(pairing, bytes); const { id } = await response.json();
  const rows = await (await fetch(`${base}/api/local/incidents`, { headers: dashboardHeaders })).json();
  expect(rows).toHaveLength(1); expect(rows[0].id).toBe(id);
  const recording = await fetch(`${base}/api/local/incidents/${id}`, { headers: dashboardHeaders });
  expect(decodeTrace(new Uint8Array(await recording.arrayBuffer())).manifest.sessionId).toBe("sample-checkout");
  expect((await fetch(`${base}/api/local/incidents/${id}`, { method: "DELETE", headers: dashboardHeaders })).status).toBe(200);
  expect(await (await fetch(`${base}/api/local/incidents`, { headers: dashboardHeaders })).json()).toEqual([]);
});
it("rejects unpaired uploads, unprivileged token reads, foreign origins, and rebinding hosts", async () => {
  expect((await upload("0".repeat(64))).status).toBe(401);
  expect((await fetch(`${base}/api/local`, { headers: { Host: "localhost:5174" } })).status).toBe(401);
  expect((await fetch(`${base}/api/local`, { headers: { ...dashboardHeaders, Origin: "https://evil.example" } })).status).toBe(403);
  expect((await fetch(`${base}/api/local`, { headers: { ...dashboardHeaders, Host: "evil.example:5174" } })).status).toBe(403);
  expect((await upload(await token(), new Uint8Array([1, 2, 3]))).status).toBe(400);
});
it("keeps the pairing token and recordings available after collector restart", async () => {
  const pairing = await token(); await upload(pairing);
  await new Promise<void>(resolve => server.close(() => resolve()));
  const collector = createCollector(directory);
  server = createServer((req, res) => void collector(req, res, () => res.end()));
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  expect(await token()).toBe(pairing);
  expect(await (await fetch(`${base}/api/local/incidents`, { headers: dashboardHeaders })).json()).toHaveLength(1);
});
it("retains only the newest 200 incidents", async () => {
  const pairing = await token();
  for (let index = 0; index < 202; index++) {
    const trace = sampleTrace(); trace.manifest.sessionId = `incident-${index}`;
    expect((await upload(pairing, encodeTrace(trace))).status).toBe(201);
  }
  const rows = await (await fetch(`${base}/api/local/incidents`, { headers: dashboardHeaders })).json();
  expect(rows).toHaveLength(200);
}, 30_000);
