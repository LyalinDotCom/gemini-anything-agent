import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ list: vi.fn(), download: vi.fn(), put:vi.fn(), patch:vi.fn(), project:vi.fn(), state:{sessions:{s:{agentMode:'object3d',envFiles:[] as any[]}}} }));
vi.mock("../src/gemini/client", () => ({ ai: () => ({ environments: { files: mocks } }), resolveApiKey: () => "test-key" }));
vi.mock('../src/state/store',()=>({useStore:{getState:()=>({...mocks.state,patchSession:mocks.patch})}}));
vi.mock('../src/storage/messages',()=>({mediaId:()=> 'test-media',putMedia:mocks.put}));
vi.mock('../src/storage/localProjects',()=>({syncEntriesToProject:mocks.project}));
import { syncOutputMedia, downloadSnapshot, downloadSnapshotArchive, selectLargeImageDownloads, downloadOutputFile } from "../src/gemini/envFiles";
import { parseTar } from "../src/utils/tar";
const glb = new Uint8Array(24);
glb.set([103, 108, 84, 70]); new DataView(glb.buffer).setUint32(8, glb.length, true);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.project.mockResolvedValue([]);
  mocks.state.sessions.s.envFiles=[];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("missing archive alias", { status: 404 })));
});

test("downloads actual output bytes through the native file API when the archive alias is missing", async () => {
  mocks.list.mockResolvedValueOnce({ files: [
    { path: "workspace/output/cutout/object.glb", type: "FILE", size_bytes: String(glb.length) },
    { path: "workspace/output/.env", type: "FILE", size_bytes: "30" },
    { path: "workspace/output/cutout", type: "DIRECTORY" },
  ], next_page_token: "next" }).mockResolvedValueOnce({ files: [{ path: "workspace/output/views/object.glb", type: "file", size_bytes: String(glb.length) }] });
  mocks.download.mockResolvedValue(glb);
  const entries = await downloadSnapshot("native-files");
  expect(entries.map((entry) => entry.name)).toEqual(["workspace/output/cutout/object.glb", "workspace/output/views/object.glb"]);
  expect(entries[0].data).toEqual(glb);
  expect(mocks.list).toHaveBeenLastCalledWith(expect.objectContaining({ page_token: "next" }));
  expect(mocks.download).toHaveBeenCalledTimes(2);
});

test("rejects metadata/body mismatch instead of syncing a truncated object", async () => {
  mocks.list.mockResolvedValue({ files: [{ path: "workspace/output/object.glb", type: "FILE", size_bytes: "100" }] });
  mocks.download.mockResolvedValue(new Uint8Array(0));
  vi.useFakeTimers();
  try {
    const done=expect(downloadSnapshot("truncated-file")).rejects.toThrow("changed during transfer");
    await vi.advanceTimersByTimeAsync(3000);await done;expect(mocks.download).toHaveBeenCalledTimes(3);
  } finally {vi.useRealTimers();}
});

test("enforces the output-size cap before downloading any file", async () => {
  mocks.list.mockResolvedValue({ files: [{ path: "workspace/output/object.glb", type: "FILE", size_bytes: String(101 * 1024 * 1024) }] });
  await expect(downloadSnapshot("large-output")).rejects.toThrow("too large");
  expect(mocks.download).not.toHaveBeenCalled();
});

test("packages native downloads as an output archive", async () => {
  mocks.list.mockResolvedValue({ files: [{ path: "workspace/output/object.glb", type: "FILE", size_bytes: String(glb.length) }] });
  mocks.download.mockResolvedValue(glb);
  const archive = await downloadSnapshotArchive("native-archive");
  expect(parseTar(await archive.arrayBuffer())[0].data).toEqual(glb);
});

test("rejects incorrect binary content even when the size matches", async () => {
  mocks.list.mockResolvedValue({ files: [{ path: "workspace/output/preview.png", type: "FILE", size_bytes: "12" }] });
  mocks.download.mockResolvedValue(new TextEncoder().encode("python bytes"));
  vi.useFakeTimers();
  try {
    const done=expect(downloadSnapshot("invalid-binary")).rejects.toThrow("invalid bytes");
    await vi.advanceTimersByTimeAsync(3000);await done;expect(mocks.download).toHaveBeenCalledTimes(3);
  } finally {vi.useRealTimers();}
});

test("does not treat permission failures as missing snapshot aliases", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
  await expect(downloadSnapshot("denied-environment")).rejects.toThrow();
  expect(mocks.list).not.toHaveBeenCalled();
});


test("prioritizes the explorable viewer and defers full-resolution images and intermediates", () => {
 const mb=1024*1024;
 const files=[{path:'workspace/output/run/mosaic.png',size:160*mb},{path:'workspace/output/run/mosaic.jpg',size:45*mb},{path:'workspace/output/run/tiles/tile_r0_c0.png',size:5*mb},{path:'workspace/output/run/deepzoom.zip',size:70*mb},{path:'workspace/output/run/preview_overview.jpg',size:mb},{path:'workspace/output/run/validation.json',size:1000}];
 expect(selectLargeImageDownloads(files).map(f=>f.path)).toEqual([files[3].path,files[4].path,files[5].path]);
});
test("individual large-image downloads do not inherit the aggregate snapshot cap", async () => {
 mocks.download.mockResolvedValue(glb);
 const entry=await downloadOutputFile('individual',{path:'/workspace/output/object.glb',size:glb.length});
 expect(entry.data).toEqual(glb);expect(mocks.download).toHaveBeenCalledWith({environment:'individual',path:'workspace/output/object.glb'});
});
test("recovers from transient wrong snapshot bytes without syncing them", async () => {
 vi.useFakeTimers();
 try {
  mocks.download.mockResolvedValueOnce(new Uint8Array(glb.length)).mockResolvedValueOnce(glb);
  const pending=downloadOutputFile('changing-snapshot',{path:'workspace/output/object.glb',size:glb.length});
  await vi.advanceTimersByTimeAsync(2000);
  expect((await pending).data).toEqual(glb);expect(mocks.download).toHaveBeenCalledTimes(2);
 } finally { vi.useRealTimers(); }
});
test("native permission errors are never retried",async()=>{
 mocks.download.mockRejectedValue(new Error('403 PERMISSION_DENIED'));
 await expect(downloadOutputFile('forbidden',{path:'workspace/output/object.glb',size:glb.length})).rejects.toThrow('PERMISSION_DENIED');
 expect(mocks.download).toHaveBeenCalledTimes(1);
});
test("refreshes stale metadata before accepting a completed file",async()=>{
 mocks.download.mockResolvedValue(glb);
 mocks.list.mockResolvedValue({files:[{path:'workspace/output/object.glb',type:'FILE',size_bytes:String(glb.length)}]});
 expect((await downloadOutputFile('growing',{path:'workspace/output/object.glb',size:10})).size).toBe(glb.length);
 expect(mocks.download).toHaveBeenCalledTimes(1);expect(mocks.list).toHaveBeenCalledTimes(1);
});
test("rejects a PNG that has a valid header but no complete terminal chunk",async()=>{
 const {validOutputSignature}=await import('../src/utils/outputIntegrity');
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64'));
 expect(validOutputSignature('complete.png',png)).toBe(true);
 expect(validOutputSignature('partial.png',png.slice(0,-4))).toBe(false);
 const partial=png.slice();partial.fill(0,partial.length-12);
 expect(validOutputSignature('partial.png',partial)).toBe(false);
});

test("imports valid media and warns when a malformed sidecar cannot sync",async()=>{
 vi.useFakeTimers();
 try {
  mocks.list.mockResolvedValue({files:[{path:'workspace/output/object.glb',type:'FILE',size_bytes:String(glb.length)},{path:'workspace/output/metrics.json',type:'FILE',size_bytes:'3'}]});
  mocks.download.mockImplementation(({path})=>Promise.resolve(path.endsWith('.glb')?glb:new TextEncoder().encode('NaN')));
  const old={path:'workspace/output/metrics.json',fingerprint:'cached-good',label:'metrics.json',kind:'code',mediaId:'old-good',mimeType:'application/json',size:9,syncedAt:1};mocks.state.sessions.s.envFiles=[old];
  const done=expect(syncOutputMedia('s','mixed-files')).rejects.toThrow('Valid output files were kept');
  await vi.advanceTimersByTimeAsync(3000);await done;
  expect(mocks.put).toHaveBeenCalledTimes(1);
  expect(mocks.patch).toHaveBeenCalledWith('s',expect.objectContaining({envFiles:expect.arrayContaining([expect.objectContaining({path:'workspace/output/object.glb'}),old])}));
  expect(mocks.project).toHaveBeenCalledWith('s',[expect.objectContaining({name:'workspace/output/object.glb'})],false);
 } finally{vi.useRealTimers();}
});
test("accepts complete PNGs with trailing data and compressed Blender containers",async()=>{
 const {validOutputSignature}=await import('../src/utils/outputIntegrity');
 const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==','base64'));
 const padded=new Uint8Array(png.length+4);padded.set(png);padded.set([1,2,3,4],png.length);
 expect(validOutputSignature('complete.png',padded)).toBe(true);
 for(const header of [[31,139,8],[40,181,47,253]]){const blend=new Uint8Array(12);blend.set(header);expect(validOutputSignature('packed.blend',blend)).toBe(true);}
});
