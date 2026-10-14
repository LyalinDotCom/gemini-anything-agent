import {test,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {listOutputFiles,downloadOutputFile} from '../src/gemini/envFiles';
import {deepZoomEntries,validateDeepZoomManifest,validateDeepZoomTiles} from '../src/utils/deepZoomArchive';
const env=process.env.LARGE_IMAGE_OUTPUT_ENV;
test.skipIf(!env||!process.env.GEMINI_API_KEY)('native transfers preserve a generated100MP mosaic and complete explorable pyramid',async()=>{
 const files=await listOutputFiles(env!);const prefix='workspace/output/large-images/seuss-world/';
 const root='../outputs/large-image-v1/artifacts';mkdirSync(root,{recursive:true});
 const hashes:Record<string,{bytes:number;sha256:string}>={};
 for(const name of ['validation.json','world_plan.json','preview_overview.jpg','deepzoom.zip','mosaic.jpg','mosaic.png']){
  const file=files.find(f=>f.path===prefix+name);expect(file,name).toBeTruthy();
  const entry=await downloadOutputFile(env!,file!);writeFileSync(`${root}/${name}`,entry.data);
  hashes[name]={bytes:entry.size,sha256:createHash('sha256').update(entry.data).digest('hex')};
  if(name==='mosaic.png'){const view=new DataView(entry.data.buffer,entry.data.byteOffset);expect([view.getUint32(16),view.getUint32(20)]).toEqual([13334,7500]);}
  if(name==='world_plan.json'){const plan=JSON.parse(new TextDecoder().decode(entry.data));expect(Object.keys(plan.districts)).toHaveLength(49);}
  if(name==='deepzoom.zip'){const zip=deepZoomEntries(entry.data);const manifest=validateDeepZoomManifest(JSON.parse(new TextDecoder().decode(zip.get('manifest.json'))));validateDeepZoomTiles(zip,manifest);expect([manifest.width,manifest.height]).toEqual([13334,7500]);expect((manifest.districts as unknown[]).length).toBe(49);}
 }
 writeFileSync(`${root}/download-hashes.json`,JSON.stringify(hashes,null,2));
},12*60_000);
