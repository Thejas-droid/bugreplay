import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./popup.css";
function App() {
  const [enabled, setEnabled] = useState(false); const [token, setToken] = useState(""); const [screenshot, setScreenshot] = useState(true);
  const [pending, setPending] = useState(0); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [deliveryError, setDeliveryError] = useState("");
  async function send(type: string) {
    setBusy(true); setError("");
    try {
      const result = await chrome.runtime.sendMessage({ type, token, screenshot });
      if (!result?.ok) throw new Error(result?.error || "The extension could not be reached.");
      setEnabled(result.enabled); setPending(result.pending); setDeliveryError(result.deliveryError || "");
      if (result.token) setToken(result.token); if (result.screenshot !== undefined) setScreenshot(result.screenshot);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to update monitoring."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void send("STATUS"); }, []);
  return <main><header><div className="brand"><span>↻</span>BugReplay</div><span className={`badge ${enabled ? "live" : ""}`}>{enabled ? "● Monitoring" : "Off"}</span></header>
    <p className="intro">Automatically capture errors in this window.</p>
    <p className="hint">JavaScript errors, rejected promises, console errors, and failed fetch/XHR requests become incidents in your local dashboard. Monitoring follows new tabs and page reloads.</p>
    {!enabled && <><label>Dashboard pairing token<input type="password" autoComplete="off" value={token} onChange={e => setToken(e.target.value)} placeholder="Copy from the local dashboard" /></label><label className="checkbox"><input type="checkbox" checked={screenshot} onChange={e => setScreenshot(e.target.checked)} />Include screenshots of visible tabs (fields masked)</label><p className="hint">Enabling capture covers all normal websites in this window. Screenshots can include personal details outside masked fields.</p></>}
    <button className="primary" disabled={busy} onClick={() => void send(enabled ? "DISABLE" : "ENABLE")}>{busy ? "Working…" : enabled ? "Turn monitoring off" : "Turn monitoring on"}</button>
    <p className="notice" role="status">{pending ? `${pending} incident${pending === 1 ? "" : "s"} waiting for delivery.` : "No incidents waiting for delivery."}</p>
    {pending > 0 && <button disabled={busy} onClick={() => void send("RETRY")}>Retry delivery</button>}
    {deliveryError && <p className="hint" role="status">{deliveryError}</p>}{error && <p className="error" role="alert">{error}</p>}
    <div className="privacy"><b>◇ Stored on your computer · no downloads</b><p>Offline incidents remain in the extension until delivered. No account or paid service is required.</p></div>
    <a className="viewer" href="http://localhost:5174" target="_blank" rel="noreferrer">Open local dashboard ↗</a><p className="limitation">Browser-internal pages and cross-origin frames are excluded. Monitoring turns off when the browser restarts. Background tabs have event data without screenshots.</p>
  </main>;
}
createRoot(document.getElementById("root")!).render(<App />);
