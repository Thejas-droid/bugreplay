export type Severity = "info"|"warning"|"error";
export type ReplayConfidence = "high"|"medium"|"low"|"unsupported";
export interface BaseEvent { id:string; type:string; timestamp:number; sequence:number; frameId?:string; correlationId?:string; severity?:Severity; }
export interface TargetHint { selector?:string; fallbackSelector?:string; bugReplayId?:string; testId?:string; id?:string; role?:string; name?:string; tag?:string; textHint?:string; attributes?:Record<string,string>; x?:number; y?:number; }
export interface InteractionEvent extends BaseEvent { type:`interaction.${string}`; target?:TargetHint; value?:unknown; redacted?:boolean; key?:string; pointer?:{x:number;y:number;button:number}; }
export interface NetworkEvent extends BaseEvent { type:`network.${string}`; requestId:string; method:string; url:string; status?:number; durationMs?:number; error?:string; requestBody?:unknown; responseBody?:unknown; requestHeaders?:Record<string,string>; responseHeaders?:Record<string,string>; bodyHash?:string; resourceType?:string; }
export interface ConsoleEvent extends BaseEvent { type:`console.${string}`; message:string; args?:unknown[]; stack?:string; }
export interface ErrorEvent extends BaseEvent { type:`error.${string}`; message:string; stack?:string; source?:string; line?:number; column?:number; }
export interface DomEvent extends BaseEvent { type:`dom.${string}`; snapshotId?:string; mutations?:unknown[]; html?:string; }
export interface PerformanceEvent extends BaseEvent { type:`performance.${string}`; durationMs?:number; value?:number; name?:string; data?:Record<string,unknown>; }
export interface NavigationEvent extends BaseEvent { type:`navigation.${string}`; from?:string; to:string; }
export interface ApplicationEvent extends BaseEvent { type:`application.${string}`; name:string; data?:unknown; }
export type TraceEvent = InteractionEvent|NetworkEvent|ConsoleEvent|ErrorEvent|DomEvent|PerformanceEvent|NavigationEvent|ApplicationEvent|BaseEvent;
export interface EnvironmentInfo { userAgent:string; browser?:string; browserVersion?:string; os?:string; viewport:{width:number;height:number}; screen:{width:number;height:number}; devicePixelRatio:number; language:string; timezone:string; colorScheme:string; reducedMotion:boolean; online:boolean; hardwareConcurrency?:number; }
export interface PrivacySummary { inputValues:number; headers:number; queryParams:number; jsonValues:number; domTextNodes:number; tokenStrings:number; total:number; }
export interface TraceManifest { traceVersion:"1.0"; sessionId:string; project:string; startedAt:string; durationMs:number; eventCount:number; replayConfidence:ReplayConfidence; incomplete?:boolean; marker?:{timestamp:number;description?:string}; files:{events:string;environment:string;privacy:string;network?:string;snapshots?:string[];screenshots?:string[]}; }
export interface BugReplayTrace { manifest:TraceManifest; events:TraceEvent[]; environment:EnvironmentInfo; privacy:PrivacySummary; snapshots?:Record<string,string>; screenshots?:Record<string,Uint8Array>; }
export const now = () => typeof performance!=="undefined" ? performance.now() : Date.now();
export const uid = (prefix="br") => `${prefix}_${crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
