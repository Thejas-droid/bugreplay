import type { BugReplayTrace, TraceEvent } from "@bugreplay/shared";

export function eventLabel(event: TraceEvent): string {
  const e = event as any;
  const target = e.target?.name || e.target?.textHint || e.target?.testId || e.target?.selector || "a page element";
  if (e.type === "interaction.click") return `Clicked ${target}`;
  if (e.type === "interaction.dblclick") return `Double-clicked ${target}`;
  if (e.type === "interaction.input") return `Entered ${e.redacted ? "a hidden value" : JSON.stringify(String(e.value ?? "").slice(0, 120))} in ${target}`;
  if (e.type === "interaction.select") return `Selected ${e.redacted ? "a hidden value" : JSON.stringify(e.value)} in ${target}`;
  if (e.type === "interaction.check") return `${e.value ? "Checked" : "Unchecked"} ${target}`;
  if (e.type === "interaction.keydown") return `Pressed ${e.key} on ${target}`;
  if (e.type === "interaction.scroll") return "Scrolled the page";
  if (e.type.startsWith("navigation.")) { try { return `Opened ${new URL(e.to, "http://local").pathname}`; } catch { return `Opened ${e.to}`; } }
  if (e.type.startsWith("network.")) return `${e.method} ${e.url}${e.status ? ` · ${e.status}` : e.error ? ` · ${e.error}` : ""}`;
  if (e.type === "application.bug-marker") return e.data?.description || "Bug marked here";
  if (e.type.includes("longtask") || e.type.includes("long-task")) return `Page busy for ${Math.round(e.durationMs ?? 0)} ms`;
  if (e.type === "performance.layout-shift") return `Page layout moved · score ${Number(e.value ?? 0).toFixed(3)}`;
  if (e.type === "dom.snapshot") return "Page structure saved";
  if (e.type === "dom.mutations") return `Page updated · ${e.mutations?.length ?? 0} changes`;
  return e.message || e.name || e.type.replace(/[.-]/g, " ");
}
export function readableSteps(trace: BugReplayTrace): TraceEvent[] {
  const steps: TraceEvent[] = [];
  for (const event of trace.events) {
    if (!["navigation.initial", "navigation.route", "interaction.click", "interaction.dblclick", "interaction.input", "interaction.select", "interaction.check", "interaction.submit"].includes(event.type)) continue;
    const previous = steps[steps.length - 1] as any;
    const e = event as any;
    const key = (row: any) => row.target?.selector || row.target?.fallbackSelector || row.target?.name;
    if (event.type === "interaction.input" && previous?.type === event.type && key(previous) === key(e)) steps[steps.length - 1] = event;
    else steps.push(event);
  }
  return steps;
}
export function markdownReport(trace: BugReplayTrace, title = "BugReplay report", details?: { actual?: string; expected?: string }) {
  const ev = trace.events as any[];
  const errors = ev.filter(e => e.type.startsWith("error.") || e.type === "console.error");
  const failed = ev.filter(e => e.type === "network.failed");
  const perf = ev.filter(e => ["performance.longtask", "performance.long-task"].includes(e.type));
  return `# ${title}\n\n${details?.actual ? `## What happened\n${details.actual}\n\n` : ""}${details?.expected ? `## What should have happened\n${details.expected}\n\n` : ""}## Recording\n- Project: ${trace.manifest.project}\n- Duration: ${(trace.manifest.durationMs / 1000).toFixed(1)} seconds\n- Replay confidence: ${trace.manifest.replayConfidence} (capture estimate; replay has not been run)\n${trace.manifest.incomplete ? "- Some recording data was not retained.\n" : ""}\n## Environment\n- Browser: ${trace.environment.browser ?? trace.environment.userAgent} ${trace.environment.browserVersion ?? ""}\n- OS: ${trace.environment.os ?? "Not identified"}\n- Viewport: ${trace.environment.viewport.width} × ${trace.environment.viewport.height}\n- Timezone: ${trace.environment.timezone}\n\n## Steps to reproduce\n${readableSteps(trace).map((e, i) => `${i + 1}. ${eventLabel(e)}`).join("\n") || "No actions were recorded."}\n\n## Errors\n${errors.map(e => `- ${e.message}`).join("\n") || "No JavaScript or console errors were recorded."}\n\n## Failed requests\n${failed.map(e => `- ${eventLabel(e)}`).join("\n") || "No failed requests were recorded."}\n\n## Performance\n${perf.map(e => `- Page busy for ${Math.round(e.durationMs ?? 0)} ms`).join("\n") || "No long tasks were recorded."}\n\n## Privacy and attachments\n- ${trace.privacy.total} redactions were applied during capture and finalization. This is a count, not a guarantee that all personal information was removed.\n- Review the report before sharing. Attach the .bugreplay recording separately if needed.\n`;
}
export async function createGitHubIssue(opts: { owner: string; repo: string; token: string; title: string; body: string; confirm: boolean }) {
  if (!opts.confirm) throw new Error("Review and confirm the report before sending it.");
  if (![opts.owner, opts.repo].every(value => /^[\w.-]+$/.test(value))) throw new Error("Enter a valid repository owner and name.");
  const response = await fetch(`https://api.github.com/repos/${opts.owner}/${opts.repo}/issues`, { method: "POST", headers: { Authorization: `Bearer ${opts.token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" }, body: JSON.stringify({ title: opts.title, body: opts.body }) });
  if (!response.ok) throw new Error(`GitHub could not create the issue (${response.status}). Check the repository and token permissions, or download the report.`);
  return response.json();
}
export async function createJiraIssue(opts: { baseUrl: string; email: string; token: string; projectKey: string; issueType?: string; summary: string; description: string; confirm: boolean }) {
  if (!opts.confirm) throw new Error("Review and confirm the report before sending it.");
  const base = new URL(opts.baseUrl); if (base.protocol !== "https:" || base.username || base.password) throw new Error("Use an HTTPS Jira site address without embedded credentials.");
  const auth = btoa(`${opts.email}:${opts.token}`);
  const response = await fetch(`${base.origin}/rest/api/3/issue`, { method: "POST", headers: { Authorization: `Basic ${auth}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ fields: { project: { key: opts.projectKey }, issuetype: { name: opts.issueType ?? "Bug" }, summary: opts.summary, description: { type: "doc", version: 1, content: opts.description.split("\n").filter(Boolean).map(text => ({ type: "paragraph", content: [{ type: "text", text }] })) } } }) });
  if (!response.ok) throw new Error(`Jira could not create the issue (${response.status}). Check the site, project and token permissions, or download the report.`);
  return response.json();
}
