// Voice capture via MediaRecorder (Spark's proven approach — NOT the Live API).
export function pickAudioMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const mime of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return "";
}

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private cancelled = false;

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (this.cancelled) { stream.getTracks().forEach(track => track.stop()); throw new DOMException("Recording cancelled", "AbortError"); }
    this.stream = stream;
    try {
    const mime = pickAudioMime();
    this.recorder = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(250);
    } catch (error) { this.cleanup(); throw error; }
  }

  stop(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const rec = this.recorder;
      if (!rec) return reject(new Error("not recording"));
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/webm" });
        this.cleanup();
        resolve(blob);
      };
      rec.stop();
    });
  }

  cancel(): void {
    this.cancelled = true;
    try {
      this.recorder?.stop();
    } catch {
      // already stopped
    }
    this.cleanup();
  }

  private cleanup(): void {
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.recorder = null;
  }
}
