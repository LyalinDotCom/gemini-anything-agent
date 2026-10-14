import {afterEach,expect,test,vi} from 'vitest';
import {browserApiFetch} from '../src/gemini/client';
afterEach(()=>vi.unstubAllGlobals());
test('SDK fetch strips the unsupported header only on the exact Google API origin',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetch);
 await browserApiFetch('https://generativelanguage.googleapis.com/v1beta/agents',{headers:{'api-revision':'latest','x-goog-api-key':'test-only'}});
 expect(new Headers(fetch.mock.calls[0][1].headers).has('api-revision')).toBe(false);
 expect(new Headers(fetch.mock.calls[0][1].headers).get('x-goog-api-key')).toBe('test-only');
 await browserApiFetch('https://example.com/generativelanguage.googleapis.com',{headers:{'api-revision':'keep'}});
 expect(new Headers(fetch.mock.calls[1][1].headers).get('api-revision')).toBe('keep');
});
test('SDK fetch preserves a Request method/body while removing the CORS-only header',async()=>{
 const fetch=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetch);
 await browserApiFetch(new Request('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',body:'{"input":"hello"}',headers:{'Api-Revision':'latest'}}));
 const request=fetch.mock.calls[0][0] as Request;
 expect(request.method).toBe('POST');expect(await request.text()).toBe('{"input":"hello"}');expect(request.headers.has('api-revision')).toBe(false);
});
