export interface PendingIncident { id: string; bytes: Uint8Array; createdAt: number; }
const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("bugreplay-outbox", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("incidents", { keyPath: "id" });
  request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
});
async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("incidents", mode); const request = action(tx.objectStore("incidents"));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error || new Error("Local queue storage failed")); };
  });
}
export const pendingIncidents = () => transact("readonly", store => store.getAll()) as Promise<PendingIncident[]>;
export const removeIncident = (id: string) => transact("readwrite", store => store.delete(id));
export async function enqueue(incident: PendingIncident) {
  const rows = await pendingIncidents(); const prior = rows.find(row => row.id === incident.id);
  if ((!prior && rows.length >= 50) || rows.reduce((sum, row) => sum + row.bytes.byteLength, 0) - (prior?.bytes.byteLength || 0) + incident.bytes.byteLength > 100_000_000) throw new Error("Offline queue is full. Start the local dashboard and retry delivery.");
  await transact("readwrite", store => store.put(incident));
}
