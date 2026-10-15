import { afterEach, expect, test, vi } from "vitest";
import { VoiceRecorder } from "../src/utils/recorder";
afterEach(() => vi.unstubAllGlobals());
test("cancelling while permission is pending releases every granted track", async () => {
 const stop=vi.fn();let grant!: (stream:any)=>void;
 vi.stubGlobal("navigator", {mediaDevices:{getUserMedia:()=>new Promise(resolve=>{grant=resolve;})}});
 const recorder=new VoiceRecorder();const start=recorder.start();recorder.cancel();grant({getTracks:()=>[{stop}]});
 await expect(start).rejects.toMatchObject({name:"AbortError"});expect(stop).toHaveBeenCalledOnce();
});
test("a failed MediaRecorder constructor releases the acquired microphone", async () => {
 const stop=vi.fn();vi.stubGlobal("navigator",{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[{stop}]})}});
 class BrokenRecorder {static isTypeSupported(){return false;}constructor(){throw new Error("Codec unavailable");}}
 vi.stubGlobal("MediaRecorder",BrokenRecorder);
 await expect(new VoiceRecorder().start()).rejects.toThrow("Codec unavailable");expect(stop).toHaveBeenCalledOnce();
});
