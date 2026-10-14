import { afterEach, expect, test, vi } from 'vitest';
import { withChatTurnLock } from '../src/chat/turnLock';
afterEach(()=>vi.unstubAllGlobals());
test('recovery skips a run owned by another tab and uses the same lock as sends',async()=>{
 const request=vi.fn(async(_id:string,_options:unknown,callback:(lock:unknown)=>Promise<void>)=>callback(null));
 vi.stubGlobal('navigator',{locks:{request}});
 const recover=vi.fn(); await withChatTurnLock('chat-a',true,recover);
 expect(request).toHaveBeenCalledWith('gaa-turn-chat-a',{ifAvailable:true},expect.any(Function));
 expect(recover).not.toHaveBeenCalled();
 request.mockImplementation(async(_id,_options,callback)=>callback({name:'gaa-turn-chat-a'}));
 const send=vi.fn(); await withChatTurnLock('chat-a',false,send);
 expect(request).toHaveBeenLastCalledWith('gaa-turn-chat-a',{ifAvailable:false},expect.any(Function));
 expect(send).toHaveBeenCalledOnce();
});
test('older browsers can still complete a turn without Web Locks',async()=>{
 vi.stubGlobal('navigator',{}); const run=vi.fn(); await withChatTurnLock('chat-b',false,run); expect(run).toHaveBeenCalledOnce();
});
