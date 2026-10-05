import { decodeTrace, encodeTrace } from "@bugreplay/trace-format";
import { enqueue, pendingIncidents, removeIncident } from "./queue";

interface WindowSettings { screenshot: boolean; }
const endpoint = "http://127.0.0.1:5174/api/local/incidents";
let queueWork = Promise.resolve();
let delivery: Promise<void> | undefined;
let captureWork = Promise.resolve();
let lastScreenshot = 0;
async function settings(windowId: number): Promise<WindowSettings | undefined> { return (await chrome.storage.session.get(`window:${windowId}`))[`window:${windowId}`]; }
async function command(tabId: number, type: string) {
  return chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: async type => (window as any).__bugreplayExtension?.command(type), args: [type] });
}
async function start(tab: chrome.tabs.Tab) {
  if (!tab.id || !/^https?:\/\//.test(tab.url || "") || /^http:\/\/(localhost|127\.0\.0\.1):5174(\/|$)/.test(tab.url || "")) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", files: ["bridge.js"] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["recorder.js"] });
    await command(tab.id, "START");
    await chrome.action.setBadgeText({ tabId: tab.id, text: "ON" });
    await chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: "#225b43" });
  } catch { /* Protected browser pages cannot be injected. */ }
}
async function flush() {
  if (delivery) return delivery;
  delivery = (async () => {
    await queueWork;
    const { token } = await chrome.storage.local.get("token");
    if (!token) return;
    for (const incident of await pendingIncidents()) {
      try {
        const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/vnd.bugreplay+zip" }, body: incident.bytes as unknown as BodyInit, signal: AbortSignal.timeout(10_000) });
        if (!response.ok) throw new Error(response.status === 401 ? "Pairing token rejected. Copy the current token from the dashboard." : `Dashboard rejected delivery (${response.status}).`);
        await removeIncident(incident.id); await chrome.storage.local.set({ deliveryError: "", lastDelivered: Date.now() });
      } catch (error) {
        const reason = error instanceof Error && /Dashboard|token/.test(error.message) ? error.message : "Dashboard offline. Incidents are queued locally and will retry automatically.";
        await chrome.storage.local.set({ deliveryError: reason }); break;
      }
    }
  })().finally(() => { delivery = undefined; });
  return delivery;
}
async function screenshot(tab: chrome.tabs.Tab, documentId?: string): Promise<string | undefined> {
  const work = captureWork.then(async () => {
    if (!tab.id || !documentId || Date.now() - lastScreenshot < 1000) return undefined;
    const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (active?.id !== tab.id) return undefined;
    try {
      const masked = await command(tab.id, "MASK_SCREENSHOT");
      if (masked[0]?.result?.state !== "RECORDING" || masked[0]?.documentId !== documentId) return undefined;
      const [current] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      if (current?.id !== tab.id || current.url !== tab.url) return undefined;
      lastScreenshot = Date.now();
      const data = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
      const [after] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
      const checked = await command(tab.id, "STATUS");
      return after?.id === tab.id && after.url === tab.url && checked[0]?.documentId === masked[0]?.documentId ? data : undefined;
    } catch { return undefined; }
    finally { await command(tab.id, "UNMASK_SCREENSHOT").catch(() => {}); }
  });
  captureWork = work.then(() => {}, () => {}); return work;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const popup = sender.url === chrome.runtime.getURL("popup.html");
  if (!popup && (!sender.tab?.id || sender.frameId !== 0 || !["HELLO", "INCIDENT"].includes(message?.type))) return false;
  void (async () => {
    try {
      if (!popup) {
        const tab = await chrome.tabs.get(sender.tab!.id!); const config = await settings(tab.windowId);
        if (!config) { sendResponse({ ok: false, error: "Monitoring is off in this window" }); return; }
        if (message.type === "HELLO") { await start(tab); sendResponse({ ok: true }); return; }
        if (!Array.isArray(message.bytes) || message.bytes.length > 15_000_000 || !message.bytes.every((value: unknown) => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 255)) throw new Error("Invalid incident payload");
        const bytes = new Uint8Array(message.bytes); const trace = decodeTrace(bytes);
        const operation = queueWork.then(async () => {
          await enqueue({ id: trace.manifest.sessionId, bytes, createdAt: Date.now() });
          try { if (config.screenshot && await settings(tab.windowId)) {
            const image = await screenshot(tab, sender.documentId);
            if (image) {
              const binary = atob(image.slice(image.indexOf(",") + 1));
              if (binary.length < 8_000_000) {
                trace.screenshots = { "incident.png": Uint8Array.from(binary, character => character.charCodeAt(0)) };
                trace.manifest.files.screenshots = ["screenshots/incident.png"];
                const updated = encodeTrace(trace);
                if (updated.length <= 15_000_000) await enqueue({ id: trace.manifest.sessionId, bytes: updated, createdAt: Date.now() });
              }
            }
          } } catch { /* Screenshot failure must not prevent delivery of the persisted incident. */ }
        });
        queueWork = operation.catch(() => {}); await operation;
        sendResponse({ ok: true }); void flush(); return;
      }
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error("Open a browser window first.");
      if (message.type === "ENABLE") {
        const token = String(message.token || "").trim();
        if (!/^[a-f0-9]{64}$/.test(token)) throw new Error("Copy the pairing token from the local dashboard.");
        await chrome.storage.local.set({ token });
        await chrome.storage.session.set({ [`window:${tab.windowId}`]: { screenshot: !!message.screenshot } });
        for (const page of await chrome.tabs.query({ windowId: tab.windowId })) await start(page);
        await chrome.alarms.create("delivery", { periodInMinutes: 0.5 }); void flush();
      } else if (message.type === "DISABLE") {
        await chrome.storage.session.remove(`window:${tab.windowId}`);
        for (const page of await chrome.tabs.query({ windowId: tab.windowId })) if (page.id) { await command(page.id, "STOP").catch(() => {}); await chrome.action.setBadgeText({ tabId: page.id, text: "" }); }
      } else if (message.type === "RETRY") await flush();
      else if (message.type !== "STATUS") throw new Error("Unknown action");
      const stored = await chrome.storage.local.get(["token", "deliveryError", "lastDelivered"]);
      sendResponse({ ok: true, enabled: !!await settings(tab.windowId), screenshot: (await settings(tab.windowId))?.screenshot, pending: (await pendingIncidents()).length, ...stored });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unable to complete this action.";
      if (!popup) await chrome.storage.local.set({ deliveryError: reason });
      sendResponse({ ok: false, error: reason });
    }
  })();
  return true;
});
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "delivery") void flush(); });
chrome.runtime.onStartup.addListener(() => { void chrome.alarms.create("delivery", { periodInMinutes: 0.5 }); void flush(); });
chrome.runtime.onInstalled.addListener(() => { void chrome.alarms.create("delivery", { periodInMinutes: 0.5 }); });
chrome.windows.onRemoved.addListener(windowId => { void chrome.storage.session.remove(`window:${windowId}`); });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => { if (change.status === "complete") void settings(tab.windowId).then(config => config && start({ ...tab, id: tabId })); });
