import {test,expect} from 'vitest';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {downloadSnapshot} from '../src/gemini/envFiles';
import {validOutputSignature} from '../src/utils/outputIntegrity';
const envId=process.env.PHOTO_OBJECT_TRANSFER_ENV;
test.skipIf(!envId||!process.env.GEMINI_API_KEY)('browser SDK native transfer retains actual managed cutout bytes and hashes',async()=>{
 const entries=await downloadSnapshot(envId!,true);
 const root='../outputs/photo-object-v2/web-cutout';mkdirSync(root,{recursive:true});
 const manifest=entries.find(e=>e.name.endsWith('/web-cutout-test/transfer-validation.json'));expect(manifest).toBeTruthy();
 const report=JSON.parse(new TextDecoder().decode(manifest!.data));
 for(const name of ['object.glb','object.blend','preview.png','verification.png','motion.mp4','photo-object.json']){
  const entry=entries.find(e=>e.name.endsWith(`/web-cutout-test/${name}`));expect(entry,name).toBeTruthy();
  expect(validOutputSignature(name,entry!.data)).toBe(true);
  const expected=report.artifacts.find((item:{name?:string;relative_name?:string})=>(item.relative_name??item.name)===name);
  expect(expected,name+' native hash missing').toBeTruthy();
  expect(createHash('sha256').update(entry!.data).digest('hex')).toBe(expected.sha256);
  writeFileSync(`${root}/${name}`,entry!.data);
 }
 writeFileSync(`${root}/transfer-validation.json`,manifest!.data);
 const glb=entries.find(e=>e.name.endsWith('/web-cutout-test/object.glb'))!.data;
 const length=new DataView(glb.buffer,glb.byteOffset).getUint32(12,true);
 const gltf=JSON.parse(new TextDecoder().decode(glb.slice(20,20+length)));
 expect(gltf.images.length).toBe(1);
 expect(gltf.materials[0].pbrMetallicRoughness.baseColorTexture).toBeTruthy();
 expect(gltf.materials[0].extensions.KHR_materials_unlit).toBeDefined();
},180000);
