import { beforeEach, expect, test, vi } from 'vitest';
const failures = vi.hoisted(() => ({ write: false }));
const saved = vi.hoisted(() => new Map<string, unknown[]>());
vi.mock('../src/storage/messages', () => ({
  loadTranscript: async (id:string) => saved.get(id) ?? [],
  saveTranscript: async (id:string, messages:unknown[]) => { if(failures.write) throw new Error("Quota"); saved.set(id, messages); },
  deleteSessionData: async (id:string) => { saved.delete(id); },
}));
import { useStore } from '../src/state/store';
import type { Message } from '../src/state/types';
import { mergeChatState } from '../src/state/merge';
import { chatTitle } from '../src/utils/chatTitle';
const prompt = (text:string): Message => ({id:crypto.randomUUID(),role:'user',status:'complete',createdAt:Date.now(),parts:[{kind:'text',id:'text',text}]});
beforeEach(() => {
  failures.write=false; saved.clear(); localStorage.clear();
  useStore.setState({sessions:{},sessionOrder:[],deletedSessionIds:[],activeSessionId:null,messages:{},hydrated:{},streaming:{},draftText:{}});
});
test('every New chat opens a fresh draft and preserves previous drafts', () => {
  const first=useStore.getState().createSession();useStore.getState().setDraftText(first,'Unsent notes');
  const second=useStore.getState().createSession();
  expect(second).not.toBe(first);expect(useStore.getState().activeSessionId).toBe(second);
  useStore.getState().setActiveSession(first);
  expect(useStore.getState().draftText[first]).toBe('Unsent notes');
});
test('new chats do not interrupt another chat running in the background', () => {
  const first=useStore.getState().createSession();useStore.getState().appendMessage(first,prompt('Please build a travel planning app'));
  useStore.getState().setStreaming(first,true);
  const second=useStore.getState().createSession('chat','anywhere');
  expect(useStore.getState().sessions[first].title).toBe('Build a travel planning app');
  expect(useStore.getState().streaming[first]).toBe(true);
  expect(useStore.getState().activeSessionId).toBe(second);
  expect(useStore.getState().sessions[second].agentMode).toBe('anywhere');
});
test.each(['streaming','stopped','error'] as const)('first prompt names a %s chat immediately', status => {
  const id=useStore.getState().createSession();useStore.getState().appendMessage(id,prompt('Can you please compare bicycle routes in Seattle?'));
  useStore.getState().appendMessage(id,{id:'assistant',role:'assistant',status,createdAt:Date.now(),parts:[]});
  expect(useStore.getState().sessions[id].title).toBe('Compare bicycle routes in Seattle');
});
test('custom chat names survive subsequent prompts', () => {
  const id=useStore.getState().createSession();useStore.getState().renameSession(id,'My project');
  useStore.getState().appendMessage(id,prompt('Different subject'));
  expect(useStore.getState().sessions[id].title).toBe('My project');
});
test('chat list, drafts, selected chat and transcript survive save/reload', async () => {
  const first=useStore.getState().createSession();useStore.getState().appendMessage(first,prompt('Design a moon garden'));
  useStore.getState().persistTranscript(first);
  const second=useStore.getState().createSession();useStore.getState().setDraftText(second,'Continue later');
  useStore.getState().setActiveSession(first);
  const snapshot=localStorage.getItem('gaa-store')!;
  useStore.setState({sessions:{},sessionOrder:[],activeSessionId:null,messages:{},hydrated:{},draftText:{}});
  localStorage.setItem('gaa-store',snapshot);await useStore.persist.rehydrate();
  await useStore.getState().hydrateSession(first);
  expect(useStore.getState().activeSessionId).toBe(first);
  expect(useStore.getState().sessionOrder).toEqual([second,first]);
  expect(useStore.getState().draftText[second]).toBe('Continue later');
  expect(useStore.getState().messages[first][0].parts).toEqual(prompt('Design a moon garden').parts);
});
test('a stale selection cannot reopen a deleted chat', () => {
  const old=useStore.getState().createSession();const current=useStore.getState().createSession();
  useStore.getState().deleteSession(old);useStore.getState().setActiveSession(old);
  expect(useStore.getState().activeSessionId).toBe(current);
});
test('titles are bounded and meaningful for attachment-only prompts', () => {
  expect(chatTitle(prompt('word '.repeat(100))).length).toBeLessThanOrEqual(52);
  expect(chatTitle({...prompt(''),parts:[{kind:'audio',id:'a',mediaId:'audio',mimeType:'audio/wav',label:'Voice'}]})).toBe('Voice conversation');
});

test("titles describe the first sentence without pulling in test instructions",()=>{expect(chatTitle(prompt("Please plan a weekend in Seattle. This is a navigation test."))).toBe("Plan a weekend in Seattle");});

test("an explicitly chosen New chat title is not overwritten automatically",()=>{const id=useStore.getState().createSession();useStore.getState().renameSession(id,"New chat");useStore.getState().appendMessage(id,prompt("Different subject"));expect(useStore.getState().sessions[id].title).toBe("New chat");});

 test('punctuation-only prompts still get a nonempty title',()=>{expect(chatTitle(prompt('...'))).toBe('Conversation');});
 test('cross-tab updates preserve independent navigation, active drafts and live runs', () => {
  const first=useStore.getState().createSession();
  useStore.getState().setDraftText(first,'My draft');
  const remote={...useStore.getState(),draftText:{[first]:'Stale draft'}};
  const second=useStore.getState().createSession();
  useStore.getState().appendMessage(second,prompt('Build a garden'));
  useStore.getState().patchSession(second,{lastInteractionId:'live-run'});
  useStore.getState().setStreaming(second,true);
  useStore.getState().setActiveSession(first);
  const merged=mergeChatState({...remote,activeSessionId:second},useStore.getState());
  expect(merged.activeSessionId).toBe(first);
  expect(merged.draftText[first]).toBe('My draft');
  expect(merged.sessions[second].lastInteractionId).toBe('live-run');
  expect(merged.sessionOrder).toContain(second);
  expect(merged.streaming[second]).toBe(true);
});
 test('remote deletion selects a valid chat and stale snapshots cannot resurrect it',()=>{
  const first=useStore.getState().createSession();
  const second=useStore.getState().createSession();
  const stale={...useStore.getState()};
  useStore.getState().deleteSession(second);
  const merged=mergeChatState(stale,useStore.getState());
  expect(merged.sessions[second]).toBeUndefined();
  expect(merged.activeSessionId).toBe(first);
  const removed=mergeChatState({deletedSessionIds:[first]},merged);
  expect(removed.activeSessionId).toBeNull();
  expect(removed.sessionOrder).toEqual([]);
});

 test('a remotely advanced transcript invalidates the cache and preserves every saved message', async()=>{
  const id=useStore.getState().createSession(); const first=prompt('First question');
  useStore.getState().appendMessage(id,first);
  const second=prompt('Second question from another tab'); saved.set(id,[first,second]);
  const current=useStore.getState();
  useStore.setState(mergeChatState({sessions:{[id]:{...current.sessions[id],updatedAt:current.sessions[id].updatedAt+1,messageCount:2,lastInteractionId:'remote-turn'}}},current));
  expect(useStore.getState().hydrated[id]).toBeUndefined();
  await useStore.getState().hydrateSession(id);
  expect(useStore.getState().messages[id].map(m=>m.id)).toEqual([first.id,second.id]);
  useStore.getState().persistTranscript(id);
  expect(saved.get(id)).toEqual([first,second]);
});
 test('an explicit remote agent reset clears the local record',()=>{
   const current=useStore.getState();
   expect(mergeChatState({agent:null},{...current,agent:{agentId:'gaa-test'} as any}).agent).toBeNull();
 });

 test('a remote manual rename survives newer stream metadata',()=>{
  const id=useStore.getState().createSession(); useStore.getState().setStreaming(id,true);
  const current=useStore.getState();const local={...current,sessions:{[id]:{...current.sessions[id],updatedAt:100}}};
  const merged=mergeChatState({sessions:{[id]:{...local.sessions[id],updatedAt:50,title:'Chosen name',titleManuallySet:true,titleUpdatedAt:50}}},local);
  expect(merged.sessions[id].title).toBe('Chosen name');
  expect(merged.sessions[id].updatedAt).toBe(100);
  const reverse=mergeChatState({sessions:local.sessions},{...merged,streaming:{}});
  expect(reverse.sessions[id].title).toBe('Chosen name');
});

test("localStorage quota failures do not break chat creation or discard the in-page draft",async()=>{
 vi.spyOn(localStorage,"setItem").mockImplementation(()=>{throw new Error("Quota full");});
 const id=useStore.getState().createSession();useStore.getState().setDraftText(id,"Keep this draft");
 await useStore.persist.rehydrate();expect(useStore.getState().draftText[id]).toBe("Keep this draft");
 useStore.persist.clearStorage();vi.restoreAllMocks();
});

test("a failed final save preserves the completed reply in this tab and can retry saving without a model call",async()=>{
 const id=useStore.getState().createSession();useStore.getState().appendMessage(id,prompt("Keep this answer"));
 useStore.getState().appendMessage(id,{id:'reply',role:'assistant',status:'complete',createdAt:Date.now(),parts:[{kind:'text',id:'answer',text:'Saved in memory'}]});
 failures.write=true;await useStore.getState().persistTranscript(id);expect(useStore.getState().sessions[id].historySaveError).toBe(true);
 useStore.setState(s=>({hydrated:{...s.hydrated,[id]:false}}));await useStore.getState().hydrateSession(id);
 expect(useStore.getState().messages[id].at(-1)?.status).toBe('complete');
 failures.write=false;await useStore.getState().persistTranscript(id);expect(useStore.getState().sessions[id].historySaveError).toBe(false);expect(saved.get(id)).toHaveLength(2);
});
