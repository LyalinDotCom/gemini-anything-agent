import{beforeEach,expect,test,vi}from'vitest';
const mock=vi.hoisted(()=>({cancel:vi.fn()}));
vi.mock('../src/gemini/client',()=>({ai:()=>({interactions:{cancel:mock.cancel}}),resolveApiKey:()=>''}));
vi.mock('../src/storage/messages',()=>({putMedia:vi.fn(),mediaId:()=>'',listMessages:async()=>[],saveMessages:async()=>{},saveTranscript:async()=>{}}));
import{useStore}from'../src/state/store';import{cancelServerTurn}from'../src/chat/controller';
beforeEach(()=>{vi.clearAllMocks();});
test('an unconfirmed server cancellation retains the stored run instead of orphaning it',async()=>{
 const sessionId=useStore.getState().createSession();const pending={interactionId:'running-id',messageId:'assistant',startedAt:Date.now()};
 useStore.getState().patchSession(sessionId,{pending});useStore.getState().appendMessage(sessionId,{id:'assistant',role:'assistant',createdAt:Date.now(),status:'streaming',parts:[]});useStore.getState().setStreaming(sessionId,true);
 mock.cancel.mockRejectedValue({status:400,message:'Cancellation was not accepted'});
 await cancelServerTurn(sessionId);const state=useStore.getState();
 expect(state.sessions[sessionId].pending?.interactionId).toBe('running-id');expect(state.streaming[sessionId]).toBe(true);expect(state.sessions[sessionId].cancelNotice).toContain('not confirmed');
});
test('a cancellation acknowledgement that remains running is not treated as confirmed',async()=>{
 const sessionId=useStore.getState().createSession();useStore.getState().patchSession(sessionId,{pending:{interactionId:'still-running',messageId:'assistant',startedAt:Date.now()}});useStore.getState().setStreaming(sessionId,true);
 mock.cancel.mockResolvedValue({id:'still-running',status:'in_progress'});await cancelServerTurn(sessionId);
 expect(useStore.getState().sessions[sessionId].pending?.interactionId).toBe('still-running');expect(useStore.getState().streaming[sessionId]).toBe(true);
});

test('a run that completed before cancellation keeps its completed status',async()=>{
 const sessionId=useStore.getState().createSession();useStore.getState().patchSession(sessionId,{pending:{interactionId:'completed-id',messageId:'assistant',startedAt:Date.now()}});useStore.getState().appendMessage(sessionId,{id:'assistant',role:'assistant',createdAt:Date.now(),status:'streaming',parts:[]});useStore.getState().setStreaming(sessionId,true);
 mock.cancel.mockResolvedValue({id:'completed-id',status:'completed'});await cancelServerTurn(sessionId);
 expect(useStore.getState().messages[sessionId].find(m=>m.id==='assistant')?.status).toBe('complete');expect(useStore.getState().sessions[sessionId].pending).toBeNull();expect(useStore.getState().streaming[sessionId]).toBe(false);
});

test('confirmed cancellation preserves the conversation model selection', async()=>{
 const sessionId=useStore.getState().createSession();
 useStore.getState().patchSession(sessionId,{modelUsed:'gemini-4-argon',pending:{interactionId:'cancelled-id',messageId:'assistant',startedAt:Date.now()}});
 useStore.getState().appendMessage(sessionId,{id:'assistant',role:'assistant',createdAt:Date.now(),status:'streaming',parts:[]});
 useStore.getState().setStreaming(sessionId,true);
 mock.cancel.mockResolvedValue({id:'cancelled-id',status:'cancelled'});
 await cancelServerTurn(sessionId);
 expect(useStore.getState().sessions[sessionId].pending).toBeNull();
 expect(useStore.getState().streaming[sessionId]).toBe(false);
 expect(useStore.getState().sessions[sessionId].modelUsed).toBe('gemini-4-argon');
});

test('cancel on an idle completed chat is a no-op',async()=>{
 const id=useStore.getState().createSession();useStore.getState().patchSession(id,{lastInteractionId:'finished'});
 useStore.getState().appendMessage(id,{id:'done',role:'assistant',status:'complete',createdAt:Date.now(),parts:[]});
 await cancelServerTurn(id);expect(mock.cancel).not.toHaveBeenCalled();expect(useStore.getState().messages[id][0].status).toBe('complete');
});
test('uppercase confirmed terminal statuses release the local busy state',async()=>{
 const id=useStore.getState().createSession();useStore.getState().patchSession(id,{pending:{interactionId:'i',messageId:'a',startedAt:Date.now()}});
 useStore.getState().setStreaming(id,true);mock.cancel.mockResolvedValue({id:'i',status:'COMPLETED'});
 await cancelServerTurn(id);expect(useStore.getState().streaming[id]).toBe(false);expect(useStore.getState().sessions[id].pending).toBeNull();
});
