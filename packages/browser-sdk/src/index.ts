import { Recorder, browserCapturePlugins, type RecorderConfig, type CapturePlugin } from "@bugreplay/recorder-core";
import { downloadTrace } from "@bugreplay/trace-format";
let recorder: Recorder | undefined;
const customPlugins: CapturePlugin[] = [];
export const BugReplay = {
  init(config: RecorderConfig) {
    if (recorder && ["RECORDING", "PAUSED", "FINALIZING"].includes(recorder.state)) throw new Error("Stop the current recording before initializing another.");
    recorder = new Recorder(config); for (const plugin of [...browserCapturePlugins(config), ...customPlugins]) recorder.use(plugin); return this;
  },
  use(plugin: CapturePlugin) { customPlugins.push(plugin); if (recorder?.state === "IDLE") recorder.use(plugin); return this; },
  start() { if (!recorder) throw new Error("Call BugReplay.init first"); recorder.start(); },
  pause() { recorder?.pause(); }, resume() { recorder?.resume(); }, markBug(description?: string) { recorder?.markBug(description); },
  setContext(data: Record<string, unknown>) { recorder?.setContext(data); }, breadcrumb(name: string, data?: unknown) { recorder?.breadcrumb(name, data); },
  registerStateProvider(name: string, provider: () => unknown) { if (!recorder) throw new Error("Call BugReplay.init first"); return recorder.registerStateProvider(name, provider); },
  async stop(options: { download?: boolean; filename?: string } = {}) {
    if (!recorder) throw new Error("Not initialized"); const result = await recorder.stop();
    if (options.download !== false) downloadTrace(result.bytes, options.filename ?? `bugreplay-${Date.now()}.bugreplay`); return result;
  },
  get state() { return recorder?.state ?? "IDLE"; },
};
export type { RecorderConfig, CapturePlugin };
