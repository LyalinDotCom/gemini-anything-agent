import {test,expect} from 'vitest';import{mkdirSync,writeFileSync}from'node:fs';import{ai}from'../src/gemini/client';import{validOutputSignature}from'../src/utils/outputIntegrity';
test.skipIf(!process.env.LARGE_IMAGE_INSPECT_ENV)('download existing source tiles for visual diagnosis',async()=>{
const env=process.env.LARGE_IMAGE_INSPECT_ENV!;const dest=process.env.LARGE_IMAGE_REPAIRED==='1'?'../outputs/large-image-v1/source-check-repaired':'../outputs/large-image-v1/source-check';mkdirSync(dest,{recursive:true});
for(const name of (process.env.LARGE_IMAGE_REPAIRED==='1'?['tile_r0_c1.png','tile_r0_c3.png','tile_r3_c0.png','tile_r3_c1.png']:['tile_r0_c0.png','tile_r0_c1.png','tile_r0_c2.png','ref_r0_c1.png'])){const bytes=await ai().environments.files.download({environment:env,path:'workspace/.large-image-work/seuss-world-live/tiles/'+name});expect(validOutputSignature(name,new Uint8Array(bytes)),name).toBe(true);writeFileSync(dest+'/'+name,bytes);}
},6*60_000);
