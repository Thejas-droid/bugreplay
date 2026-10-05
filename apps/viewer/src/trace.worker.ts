import { decodeTrace } from "@bugreplay/trace-format";
self.onmessage = (event: MessageEvent<ArrayBuffer>) => {
  try { self.postMessage({ trace: decodeTrace(new Uint8Array(event.data)) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Unable to read this recording." }); }
};
