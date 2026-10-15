import {afterEach,expect,test,vi} from "vitest";
afterEach(()=>vi.unstubAllGlobals());
async function database(mode:"read-error"|"write-abort") {
 vi.resetModules();const error=new DOMException("Storage failed","QuotaExceededError");
 const db={close(){},transaction(){const tx:any={error,objectStore:()=>({get(){const request:any={error};queueMicrotask(()=>request.onerror());return request;},put(){queueMicrotask(()=>tx.onabort());}})};return tx;}};
 vi.stubGlobal("indexedDB",{open(){const request:any={result:db};queueMicrotask(()=>request.onsuccess());return request;}});
 return {api:await import("../src/storage/db"),error,mode};
}
test("a failed saved-history read rejects rather than masquerading as empty history",async()=>{const {api,error}=await database("read-error");await expect(api.idbGet("messages","chat")).rejects.toBe(error);});
test("an aborted write rejects so callers and chat locks cannot hang forever",async()=>{const {api,error}=await database("write-abort");await expect(api.idbPut("messages",{sessionId:"chat",messages:[]})).rejects.toBe(error);});
