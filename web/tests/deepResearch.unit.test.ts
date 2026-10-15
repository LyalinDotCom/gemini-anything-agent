import {afterEach,beforeEach,expect,test,vi} from 'vitest';
const state=vi.hoisted(()=>({get:vi.fn(),create:vi.fn(),cancel:vi.fn(),failSave:false,saved:new Map<string,any[]>()}));
vi.mock('../src/gemini/client',()=>({ai:()=>({interactions:{get:state.get,create:state.create,cancel:state.cancel}})}));
vi.mock('../src/storage/messages',()=>({loadTranscript:async(id:string)=>state.saved.get(id)??[],saveTranscript:async(id:string,messages:any[])=>{if(state.failSave)throw new Error('Quota');state.saved.set(id,messages);},deleteSessionData:async()=>{}}));
import {sendResearchTurn,resumeResearchIfNeeded,cancelResearchTurn} from '../src/gemini/deepResearch';
import {useStore} from '../src/state/store';
beforeEach(()=>{
 vi.clearAllMocks();state.failSave=false;state.saved.clear();localStorage.clear();
 useStore.setState({sessions:{},sessionOrder:[],deletedSessionIds:[],activeSessionId:null,messages:{},hydrated:{},streaming:{},draftText:{}});
 state.create.mockResolvedValue({id:'research-id'});
 state.get.mockImplementation(async(_id:string,options?:{stream?:boolean})=>{if(options?.stream)throw {status:503};return{id:'research-id',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Research result'}]}]};});
});
afterEach(()=>vi.useRealTimers());
test('research completes and saves its two-message transcript',async()=>{
 const id=useStore.getState().createSession('chat','deep-research');await sendResearchTurn(id,'Explain eclipses');
 expect(useStore.getState().sessions[id].research).toBeNull();expect(useStore.getState().streaming[id]).toBe(false);
 expect(state.saved.get(id)).toHaveLength(2);expect(useStore.getState().sessions[id].title).toBe('Explain eclipses');
});
test('resume hydrates the original placeholder without creating a duplicate reply',async()=>{
 const id=useStore.getState().createSession('chat','deep-research');const assistant={id:'existing',role:'assistant' as const,status:'streaming' as const,createdAt:0,parts:[]};
 state.saved.set(id,[assistant]);useStore.setState(s=>({hydrated:{...s.hydrated,[id]:false}}));
 useStore.getState().patchSession(id,{research:{interactionId:'research-id',startedAt:0}});
 await resumeResearchIfNeeded(id);expect(useStore.getState().messages[id]).toHaveLength(1);expect(useStore.getState().messages[id][0].id).toBe('existing');expect(state.create).not.toHaveBeenCalled();
});
test('a transient poll failure retains the job and succeeds after reconnecting',async()=>{
 vi.useFakeTimers();let polls=0;
 state.get.mockImplementation(async(_id:string,options?:{stream?:boolean})=>{if(options?.stream||polls++===0)throw {status:503};return{id:'research-id',status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Recovered'}]}]};});
 const id=useStore.getState().createSession('chat','deep-research');const run=sendResearchTurn(id,'Research a comet');
 await vi.advanceTimersByTimeAsync(0);expect(useStore.getState().sessions[id].research?.interactionId).toBe('research-id');
 await vi.advanceTimersByTimeAsync(10_000);await run;expect(useStore.getState().sessions[id].research).toBeNull();expect(state.saved.get(id)).toHaveLength(2);
});
test('an unconfirmed research cancellation preserves its stored run',async()=>{
 const id=useStore.getState().createSession('chat','deep-research');useStore.getState().patchSession(id,{research:{interactionId:'research-id',startedAt:0}});
 state.cancel.mockRejectedValue({status:400});await cancelResearchTurn(id);
 expect(useStore.getState().sessions[id].research?.interactionId).toBe('research-id');expect(useStore.getState().sessions[id].cancelNotice).toContain('not confirmed');
});

test('a failed device save does not erase a completed research report',async()=>{
 state.failSave=true;const id=useStore.getState().createSession('chat','deep-research');await sendResearchTurn(id,'Keep this completed report');
 const answer=useStore.getState().messages[id].at(-1)!;expect(answer.status).toBe('complete');expect(answer.parts).toContainEqual(expect.objectContaining({kind:'text',text:'Research result'}));
 expect(useStore.getState().sessions[id].historySaveError).toBe(true);
 state.failSave=false;await useStore.getState().persistTranscript(id);expect(useStore.getState().sessions[id].historySaveError).toBe(false);
});

test('a permanent research permission error clears tracking so the chat and settings are usable',async()=>{
 state.get.mockRejectedValue({status:403,message:'Permission denied'});
 const id=useStore.getState().createSession('chat','deep-research');await sendResearchTurn(id,'Research with denied permission');
 expect(useStore.getState().sessions[id].research).toBeNull();expect(useStore.getState().streaming[id]).toBe(false);
 const reply=useStore.getState().messages[id].at(-1)!;expect(reply.status).toBe('error');expect(reply.interactionId).toBe('research-id');
});
