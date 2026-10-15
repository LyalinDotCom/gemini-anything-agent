import { beforeEach, expect, test, vi } from "vitest";
const state=vi.hoisted(()=>({cached:null as string|null,download:vi.fn(),put:vi.fn()}));
vi.mock("../src/storage/messages",()=>({getMediaUrl:async()=>state.cached,putMedia:async(...args:any[])=>{state.put(...args);state.cached="blob:restored";}}));
vi.mock("../src/gemini/envFiles",()=>({downloadOutputFile:state.download}));
import {loadResourceUrl} from "../src/components/resourceSource";
const file={mediaId:"chat:file",fingerprint:"f",path:"/workspace/output/test.txt",label:"test.txt",kind:"text" as const,mimeType:"text/plain",size:4,syncedAt:0,environmentId:"env"};
beforeEach(()=>{state.cached=null;state.download.mockReset();state.put.mockClear();state.download.mockResolvedValue({data:new Uint8Array([1,2,3,4])});});
test("missing cached media is restored from its original environment",async()=>{expect(await loadResourceUrl(file)).toBe("blob:restored");expect(state.download).toHaveBeenCalledWith("env",file);expect(state.put.mock.calls[0][1]).toBe("chat");});
test("missing and remote-only resources produce an actionable error instead of endless loading",async()=>{await expect(loadResourceUrl({...file,environmentId:undefined})).rejects.toThrow("unavailable");await expect(loadResourceUrl({...file,remoteOnly:true})).rejects.toThrow("Files");expect(state.download).not.toHaveBeenCalled();});
