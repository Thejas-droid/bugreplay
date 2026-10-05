// The page-world recorder has no Chrome APIs or pairing credentials.
const isolated = globalThis as any;
if (!isolated.__bugreplayBridge) {
  isolated.__bugreplayBridge = true;
  let busy = false;
  window.addEventListener("message", event => {
    if (event.source !== window || event.data?.source !== "bugreplay-recorder" || event.data?.type !== "INCIDENT" || busy) return;
    const { bytes, id } = event.data;
    if (!Array.isArray(bytes) || bytes.length > 15_000_000 || typeof id !== "string" || id.length > 150) return;
    busy = true;
    void chrome.runtime.sendMessage({ type: "INCIDENT", bytes }).then(result => {
      window.postMessage({ source: "bugreplay-bridge", type: "ACK", id, ok: !!result?.ok }, location.origin);
    }).catch(() => { window.postMessage({ source: "bugreplay-bridge", type: "ACK", id, ok: false }, location.origin); }).finally(() => { busy = false; });
  });
  void chrome.runtime.sendMessage({ type: "HELLO" }).catch(() => {});
}
