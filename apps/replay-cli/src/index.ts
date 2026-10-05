#!/usr/bin/env node
import { readFile, writeFile, access } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { decodeTrace, encodeTrace } from "@bugreplay/trace-format";
import { Redactor } from "@bugreplay/redaction";
import { replayTrace, generatePlaywrightTest } from "@bugreplay/replay-engine";
import { markdownReport, createGitHubIssue, createJiraIssue } from "@bugreplay/exporters";
const help = `BugReplay — record, understand, and reproduce a frontend bug

Run from the project folder with: pnpm cli <command>

  doctor                             Check the local replay setup
  init                               Write a starter SDK snippet
  open trace.bugreplay               Explain how to open a recording
  inspect trace.bugreplay            Show the recording summary
  report trace.bugreplay             Print a readable Markdown report
  sanitize trace.bugreplay           Apply another conservative redaction pass
  generate-test trace.bugreplay      Write a Playwright starting point
  replay trace.bugreplay             Repeat actions in a real browser
  export github trace.bugreplay      Create an issue after explicit confirmation
  export jira trace.bugreplay        Create an issue after explicit confirmation

Replay: --base-url URL [--network live|hybrid|mocked] [--mock /api/*]
        [--timing deterministic|original|accelerated] [--repeat 5]
        [--headed] [--expect-fixed] [--input-values safe-values.json]
        [--out replay-result.json]
Export: --confirm [--title TITLE]
        GitHub: --repo owner/repo and GITHUB_TOKEN environment variable
        Jira: --site https://team.atlassian.net --project TEAM
              and JIRA_EMAIL / JIRA_TOKEN environment variables
Other:  --out PATH, --help

Nothing is sent to an issue tracker unless you run export with --confirm.`;
function parse(values: string[]) {
  const flags: Record<string, string | boolean> = {}, positional: string[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index]!;
    if (!value.startsWith("--")) { positional.push(value); continue; }
    if (["--help", "--headed", "--confirm", "--expect-fixed"].includes(value)) flags[value] = true;
    else { const next = values[++index]; if (!next || next.startsWith("--")) throw new Error(`${value} needs a value.`); flags[value] = next; }
  }
  return { flags, positional };
}
async function main() {
  const { flags, positional } = parse(process.argv.slice(2)); const [command, first, second] = positional;
  const flag = (key: string, fallback = "") => typeof flags[key] === "string" ? flags[key] as string : fallback;
  if (!command || flags["--help"]) { console.log(help); return; }
  if (command === "doctor") {
    console.log(`Node ${process.versions.node} (${process.platform})`);
    try { await access(chromium.executablePath()); console.log("Chromium is installed. Start your target app before replaying."); }
    catch { console.log("Chromium is not installed. Run: pnpm --filter @bugreplay/cli exec playwright install chromium"); process.exitCode = 1; }
    return;
  }
  if (command === "init") {
    const output = flag("--out", "bugreplay.setup.ts");
    await writeFile(output, `import { BugReplay } from '@bugreplay/browser';\n\nBugReplay.init({\n  project: 'my-app',\n  redact: { selectors: ['[data-sensitive]'], maskEmails: true },\n  capture: { dom: true, performance: true, networkBodies: 'none' },\n});\n\n// Call these from explicit user actions and show a visible recording indicator.\nexport const startRecording = () => BugReplay.start();\nexport const saveRecording = () => BugReplay.stop();\n`, { flag: "wx" }); console.log(`Starter snippet written to ${output}. Connect it to your app’s Start and Save buttons.`); return;
  }
  if (command === "open") { if (!first) throw new Error("Supply a .bugreplay file."); console.log(`Run pnpm viewer, open http://localhost:5174, choose Open recording, and select ${first}. The file stays local.`); return; }
  const filename = command === "export" ? second : first; if (!filename) throw new Error("Supply a .bugreplay recording. Run pnpm cli --help for examples.");
  const trace = decodeTrace(new Uint8Array(await readFile(filename)));
  if (command === "inspect") console.log(JSON.stringify({ manifest: trace.manifest, environment: trace.environment, privacy: trace.privacy, eventTypes: Object.fromEntries([...new Set(trace.events.map(e => e.type))].map(type => [type, trace.events.filter(e => e.type === type).length])) }, null, 2));
  else if (command === "report") { const text = markdownReport(trace, flag("--title", trace.manifest.marker?.description || "BugReplay report")); if (flags["--out"]) await writeFile(flag("--out"), text); else console.log(text); }
  else if (command === "sanitize") {
    const redactor = new Redactor({ maskEmails: true, maskPhones: true });
    trace.events = trace.events.filter(event => !event.type.startsWith("dom.")).map(event => redactor.event(event));
    trace.manifest.marker = trace.manifest.marker ? { ...trace.manifest.marker, description: redactor.text(trace.manifest.marker.description ?? "") } : undefined;
    trace.manifest.project = redactor.text(trace.manifest.project); trace.environment.userAgent = redactor.text(trace.environment.userAgent);
    // Images and page snapshots cannot be safely re-masked without the original live page.
    trace.snapshots = {}; trace.screenshots = {}; trace.manifest.files.snapshots = []; trace.manifest.files.screenshots = [];
    for (const key of Object.keys(trace.privacy) as (keyof typeof trace.privacy)[]) trace.privacy[key] += redactor.summary[key];
    trace.manifest.eventCount = trace.events.length;
    const output = flag("--out", filename.replace(/\.bugreplay$/i, "") + ".sanitized.bugreplay");
    if (output === filename) throw new Error("Choose a different --out path to preserve the original recording.");
    await writeFile(output, encodeTrace(trace)); console.log(`Saved ${output}. Page snapshots and screenshots were omitted; review remaining content before sharing.`);
  } else if (command === "generate-test") {
    const output = flag("--out", "bugreplay.generated.spec.ts"); await writeFile(output, generatePlaywrightTest(trace)); console.log(`Saved ${output}. Review hidden inputs, network fixtures, and assertions before using it.`);
  } else if (command === "replay") {
    const baseUrl = flag("--base-url"); if (!baseUrl) throw new Error("Add --base-url, for example http://localhost:5173.");
    const base = new URL(baseUrl); if (!/^https?:$/.test(base.protocol) || base.username || base.password) throw new Error("Use an http or https app address without embedded credentials.");
    const mode = flag("--network", "live"), timing = flag("--timing", "deterministic"), repeat = Number(flag("--repeat", "1"));
    if (!["live", "hybrid", "mocked"].includes(mode)) throw new Error("Network mode must be live, hybrid, or mocked.");
    if (!["deterministic", "original", "accelerated"].includes(timing)) throw new Error("Timing must be deterministic, original, or accelerated.");
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error("Repeat must be between 1 and 20.");
    const inputValues = flags["--input-values"] ? JSON.parse(await readFile(flag("--input-values"), "utf8")) : undefined;
    if (inputValues && (Array.isArray(inputValues) || typeof inputValues !== "object" || Object.values(inputValues).some(value => typeof value !== "string"))) throw new Error("Input replacements must be an object of selector-to-string pairs.");
    const browser = await chromium.launch({ headless: !flags["--headed"] }); const runs = [];
    try { for (let index = 0; index < repeat; index++) { const context = await browser.newContext({ viewport: trace.environment.viewport }); try { runs.push(await replayTrace(await context.newPage(), trace, { baseUrl, network: { mode: mode as "live" | "hybrid" | "mocked", mock: flag("--mock", "/api/*").split(",") }, timing: timing as "deterministic" | "original" | "accelerated", expectFixed: !!flags["--expect-fixed"], inputValues })); } finally { await context.close(); } } }
    finally { await browser.close(); }
    const passed = runs.filter(run => run.ok).length; const result = { passed, total: repeat, stability: Math.round(passed / repeat * 100), runs };
    console.log(JSON.stringify(result, null, 2)); if (flags["--out"]) await writeFile(flag("--out"), JSON.stringify(result, null, 2)); process.exitCode = passed === repeat ? 0 : 1;
  } else if (command === "export") {
    const title = flag("--title", trace.manifest.marker?.description || "BugReplay report"), body = markdownReport(trace, title);
    if (!flags["--confirm"]) { console.log(body); console.log("\nPreview only. Review the report and destination, then rerun with --confirm to create the issue."); return; }
    if (first === "github") { const [owner, repo] = flag("--repo").split("/"); if (!owner || !repo || !process.env.GITHUB_TOKEN) throw new Error("Provide --repo owner/repo and set GITHUB_TOKEN in your environment."); const issue = await createGitHubIssue({ owner, repo, token: process.env.GITHUB_TOKEN, title, body, confirm: true }); console.log(`Created ${issue.html_url}`); }
    else if (first === "jira") { if (!process.env.JIRA_EMAIL || !process.env.JIRA_TOKEN || !flag("--site") || !flag("--project")) throw new Error("Provide --site, --project, and JIRA_EMAIL / JIRA_TOKEN environment variables."); const issue = await createJiraIssue({ baseUrl: flag("--site"), email: process.env.JIRA_EMAIL, token: process.env.JIRA_TOKEN, projectKey: flag("--project"), summary: title, description: body, confirm: true }); console.log(`Created Jira issue ${issue.key}`); }
    else throw new Error("Choose export github or export jira.");
  } else throw new Error(`Unknown command: ${command}. Run pnpm cli --help.`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : "The command could not complete."); process.exitCode = 1; });
