import type { PrivacySummary, TraceEvent } from "@bugreplay/shared";

export interface RedactionConfig {
  selectors?: string[]; screenshotSelectors?: string[]; attributes?: string[];
  jsonKeys?: string[]; queryParams?: string[]; textPatterns?: RegExp[];
  maskEmails?: boolean; maskPhones?: boolean;
}
const sensitiveHeaders = new Set(["authorization", "cookie", "set-cookie", "x-api-key", "proxy-authorization"]);
const sensitiveQuery = ["token", "access_token", "auth", "password", "secret", "key", "session"];
const sensitiveKeys = ["password", "passwd", "accesstoken", "refreshtoken", "authorization", "cookie", "apikey", "sessionid", "token", "secret"];
const defaultSelectors = 'input[type="password"],input[type="hidden"],[data-sensitive],[data-bugreplay-redact],input[name*=token i],input[name*=secret i],input[name*=password i]';
export class Redactor {
  readonly summary: PrivacySummary = { inputValues: 0, headers: 0, queryParams: 0, jsonValues: 0, domTextNodes: 0, tokenStrings: 0, total: 0 };
  constructor(public config: RedactionConfig = {}) {}
  reset() { for (const key of Object.keys(this.summary) as (keyof PrivacySummary)[]) this.summary[key] = 0; }
  private hit(key: keyof Omit<PrivacySummary, "total">) { this.summary[key]++; this.summary.total++; }
  isSensitive(element: Element) {
    return [defaultSelectors, ...(this.config.selectors ?? [])].some(selector => {
      try { return !!element.closest(selector); } catch { return false; }
    });
  }
  text(input: string, kind: "dom" | "generic" = "generic") {
    let out = input;
    const patterns = [
      /\beyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]{5,}\b/g,
      /\b(?:\d[ -]*?){13,19}\b/g,
      /\b(?:sk|pk|api)[-_][A-Za-z0-9_-]{16,}\b/g,
      /\bBearer\s+[A-Za-z0-9._~+\/-]+/gi,
      ...(this.config.textPatterns ?? []),
    ];
    if (this.config.maskEmails) patterns.push(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g);
    if (this.config.maskPhones) patterns.push(/\+?\d[\d ()-]{8,}\d/g);
    for (const pattern of patterns) {
      const regex = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
      out = out.replace(regex, () => { this.hit(kind === "dom" ? "domTextNodes" : "tokenStrings"); return "[REDACTED]"; });
    }
    return out;
  }
  url(input: string) {
    try {
      const url = new URL(input, typeof location !== "undefined" ? location.href : "http://bugreplay.local");
      const names = new Set([...sensitiveQuery, ...(this.config.queryParams ?? [])].map(key => key.toLowerCase()));
      for (const key of [...url.searchParams.keys()]) if (names.has(key.toLowerCase()) && url.searchParams.get(key) !== "[REDACTED]") {
        url.searchParams.set(key, "[REDACTED]"); this.hit("queryParams");
      }
      if (url.username || url.password) { url.username = ""; url.password = ""; this.hit("queryParams"); }
      url.hash = this.text(url.hash);
      return url.origin === "http://bugreplay.local" ? url.pathname + url.search + url.hash : url.toString();
    } catch { return this.text(input); }
  }
  headers(headers: Record<string, string> = {}) {
    return Object.fromEntries(Object.entries(headers).map(([key, value]) => {
      if (sensitiveHeaders.has(key.toLowerCase())) {
        if (value !== "[REDACTED]") this.hit("headers");
        return [key, "[REDACTED]"];
      }
      return [key, this.text(value)];
    }));
  }
  value(value: unknown, key?: string, depth = 0, seen = new WeakSet<object>()): unknown {
    const keys = new Set([...sensitiveKeys, ...(this.config.jsonKeys ?? []).map(k => k.toLowerCase())]);
    if (key && keys.has(key.toLowerCase())) { if (value !== "[REDACTED]") this.hit("jsonValues"); return "[REDACTED]"; }
    if (typeof value === "string") {
      const clipped = value.slice(0, 64_000);
      if (/^\s*[\[{]/.test(clipped)) {
        try { return JSON.stringify(this.value(JSON.parse(clipped), undefined, depth + 1, seen)); } catch { /* Plain text body. */ }
      }
      return this.text(clipped);
    }
    if (typeof value === "bigint") return String(value);
    if (typeof value === "function" || typeof value === "symbol") return String(value);
    if (value && typeof value === "object") {
      if (depth >= 8) return "[DEPTH_LIMIT]";
      if (seen.has(value)) return "[CIRCULAR]";
      seen.add(value);
      if (value instanceof Error) return { name: value.name, message: this.text(value.message), stack: this.text(value.stack ?? "") };
      if (Array.isArray(value)) return value.slice(0, 200).map(v => this.value(v, undefined, depth + 1, seen));
      const result: Record<string, unknown> = Object.create(null);
      for (const [k, v] of Object.entries(value).slice(0, 200)) result[k] = this.value(v, k, depth + 1, seen);
      return result;
    }
    return value;
  }
  input(value: string, element?: Element) {
    if (element && this.isSensitive(element)) { this.hit("inputValues"); return { value: "[REDACTED]", redacted: true }; }
    const masked = this.text(value);
    return { value: masked, redacted: masked !== value };
  }
  /** Clone first: raw input values and scripts never enter a stored snapshot. */
  snapshot(root: Element) {
    const clone = root.cloneNode(true) as Element;
    clone.querySelectorAll('script,style,noscript,[data-bugreplay-ignore]').forEach(node => node.remove());
    for (const node of [clone, ...clone.querySelectorAll("*")]) {
      if (this.isSensitive(node)) {
        node.replaceChildren(document.createTextNode("[REDACTED]"));
        if (node.hasAttribute("value")) node.setAttribute("value", "[REDACTED]");
        this.hit("domTextNodes");
      }
      for (const attribute of [...node.attributes]) {
        if (/^on/i.test(attribute.name) || attribute.name === "srcdoc") node.removeAttribute(attribute.name);
        else if (/token|secret|password|authorization|cookie/i.test(attribute.name) || this.config.attributes?.includes(attribute.name)) {
          node.setAttribute(attribute.name, "[REDACTED]"); this.hit("domTextNodes");
        } else if (["href", "src", "action", "poster"].includes(attribute.name)) node.setAttribute(attribute.name, this.url(attribute.value));
        else node.setAttribute(attribute.name, this.text(attribute.value, "dom"));
      }
    }
    return this.text(clone.outerHTML.slice(0, 1_000_000), "dom");
  }
  event<T extends TraceEvent>(event: T): T {
    const e: any = { ...event };
    for (const key of ["url", "to", "from", "source"]) if (typeof e[key] === "string") e[key] = this.url(e[key]);
    for (const key of ["requestHeaders", "responseHeaders"]) if (e[key]) e[key] = this.headers(e[key]);
    for (const key of ["value", "args", "data", "requestBody", "responseBody", "target", "mutations", "pointer"]) if (key in e) e[key] = this.value(e[key]);
    for (const key of ["message", "stack", "name", "html", "description", "error"]) if (typeof e[key] === "string") e[key] = this.text(e[key], key === "html" ? "dom" : "generic");
    return e;
  }
  auditString(s: string) { return { containsJwt: /eyJ[A-Za-z0-9_-]+\./.test(s), containsAuth: /Bearer\s+[A-Za-z0-9._-]+/i.test(s) }; }
}
