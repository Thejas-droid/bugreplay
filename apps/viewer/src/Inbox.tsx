import React, { useEffect, useState } from "react";
interface Incident { id: string; project: string; title: string; receivedAt: string; events: number; size: number; screenshot: boolean; }
const headers = { "X-BugReplay-Local": "1" };
export function Inbox({ open }: { open: (file: File) => Promise<void> }) {
  const [incidents, setIncidents] = useState<Incident[]>([]); const [token, setToken] = useState("");
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [search, setSearch] = useState(""); const [busy, setBusy] = useState("");
  useEffect(() => {
    let alive = true; let fetching = false;
    async function refresh() {
      if (fetching) return; fetching = true;
      try {
        const responses = await Promise.all([fetch("/api/local", { headers }), fetch("/api/local/incidents", { headers })]);
        if (responses.some(response => !response.ok)) throw new Error("Start the local dashboard with pnpm viewer or pnpm local:start.");
        const [config, rows] = await Promise.all(responses.map(response => response.json()));
        if (alive) { setToken(config.token); setIncidents(rows); setError(""); }
      } catch { if (alive) setError("Local inbox unavailable. Start the local dashboard with pnpm viewer or pnpm local:start."); }
      finally { fetching = false; }
    }
    void refresh(); const timer = setInterval(() => void refresh(), 3000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  async function select(row: Incident) {
    setBusy(row.id); setError("");
    try {
      const response = await fetch(`/api/local/incidents/${row.id}`, { headers });
      if (!response.ok) throw new Error("Recording could not be opened. It may have expired under the retention limit.");
      await open(new File([await response.blob()], `${row.id}.bugreplay`));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not open incident."); }
    finally { setBusy(""); }
  }
  async function remove(row: Incident) {
    if (!window.confirm("Delete this incident from your computer?")) return;
    setBusy(row.id);
    try { const response = await fetch(`/api/local/incidents/${row.id}`, { method: "DELETE", headers }); if (!response.ok) throw new Error(); setIncidents(rows => rows.filter(item => item.id !== row.id)); }
    catch { setError("Could not delete this incident. Try again."); }
    finally { setBusy(""); }
  }
  const filtered = incidents.filter(row => `${row.project} ${row.title}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="panel local-inbox" aria-label="Automatically captured incidents"><div className="panel-heading"><div><div className="eyebrow">AUTOMATIC CAPTURE</div><h2>Local incident inbox</h2><p>New bugs appear here automatically. No browser downloads.</p></div><span className="badge">{incidents.length} incidents</span></div>
    <details className="pair-extension"><summary>Connect your browser extension</summary><ol className="checklist"><li>Build and load the BugReplay extension in Chrome or Edge.</li><li>Copy the token below into the extension popup.</li><li>Turn monitoring on in the browser window you want to capture.</li></ol><button className="button secondary" disabled={!token} onClick={async () => { try { await navigator.clipboard.writeText(token); setNotice("Pairing token copied. Paste it into the BugReplay extension."); } catch { setNotice("Select and copy the token below."); } }}>Copy pairing token</button><label>Local pairing token<input readOnly value={token} onFocus={event => event.target.select()} aria-label="Local pairing token" /></label><p className="muted">Keep this token private. Recordings stay on this computer. The oldest incidents expire after 200 recordings or 500 MB.</p></details>
    {notice && <p role="status">{notice}</p>}{error && <div className="notice danger" role="alert">{error}</div>}
    <label className="inbox-search">Search incidents<input value={search} onChange={event => setSearch(event.target.value)} placeholder="Website or error message" /></label>
    <div className="incident-list">{filtered.map(row => <article className="incident-row" key={row.id}><button className="incident-open" disabled={!!busy} onClick={() => void select(row)}><span className="eyebrow">{row.project}</span><b>{busy === row.id ? "Working…" : row.title}</b><small>{new Date(row.receivedAt).toLocaleString()} · {row.events} events · {row.screenshot ? "Screenshot included" : "Event capture"}</small></button><button className="button secondary compact" disabled={!!busy} onClick={() => void remove(row)}>Delete</button></article>)}</div>
    {!filtered.length && <p className="inbox-empty">{search ? "No incidents match your search." : "Waiting for errors. Connect the extension and turn on monitoring to capture real websites."}</p>}
  </section>;
}
