import { AGENT_PROFILES, LARGE_IMAGE_UI_READY } from "../agentProfiles";
import { SAMPLE_PROMPTS } from "../samplePrompts";
import { useStore } from "../state/store";
import { T } from "../tokens";

export function SamplePromptGallery({ sessionId }: { sessionId: string }) {
  const patchSession = useStore((s) => s.patchSession);
  const setDraftText = useStore((s) => s.setDraftText);
  return (
    <div style={{ width: "100%", maxWidth: 720, marginTop: 18 }} aria-label="Sample prompts">
      <div style={{ marginBottom: 8, color: T.textFaint, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase" }}>Examples</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: 8 }}>
        <div>
          <button type="button" onClick={() => {
            patchSession(sessionId, { agentMode: "object3d", mode: "chat", object3dMethod: "views", samplePhoto: "person-cat" });
          }} style={{ width: "100%", minHeight: 112, padding: 10, borderRadius: T.radiusSm, border: `1px solid ${T.borderSoft}`, background: T.bgElev, color: T.text, cursor: "pointer", textAlign: "left" }}>
            <img src="/examples/person-cat.jpg" alt="" style={{ float: "right", width: 48, height: 86, objectFit: "cover", borderRadius: 5, marginLeft: 8 }} />
            <em style={{ display: "block", color: T.accent, fontSize: 10, fontStyle: "normal", marginBottom: 8 }}>3D View</em>
            <strong style={{ display: "block", fontSize: 13 }}>Person + cat</strong>
            <span style={{ color: T.textDim, fontSize: 11 }}>Generate from this photo</span>
          </button>
          <a href="/?sample3d=person-cat" style={{ display: "block", marginTop: 8, color: T.accent, fontSize: 12 }}>Explore the 3D sample ↗</a>
        </div>
        {LARGE_IMAGE_UI_READY && <div>
          <button type="button" onClick={() => {
            patchSession(sessionId, { agentMode: "large-image", mode: "chat", largeImageTemplate: "seuss-world" });
            setDraftText(sessionId, "Create a fresh 100 megapixel Dr. Seuss inspired world using the large-image and Dr. Seuss world skills. Make 49 connected neighbourhoods with expressive original inhabitants, curved candy-striped architecture, colourful pom-pom groves and winding turquoise rivers. Deliver the full-resolution image, an explorable deep-zoom viewer and truthful quality/provenance reports.");
          }} style={{ width: "100%", minHeight: 112, padding: 10, borderRadius: T.radiusSm, border: `1px solid ${T.borderSoft}`, background: T.bgElev, color: T.text, cursor: "pointer", textAlign: "left" }}>
            <em style={{ display: "block", color: T.accent, fontSize: 10, fontStyle: "normal", marginBottom: 8 }}>Large Images</em>
            <img src="/examples/seuss-world/overview.jpg" alt="" style={{width:"100%",height:46,objectFit:"cover",borderRadius:4,marginBottom:6}} />
            <strong style={{ display: "block", fontSize: 13 }}>Dr. Seuss World</strong>
            <span style={{ color: T.textDim, fontSize: 11 }}>100 MP · Two shared skills</span>
          </button>
          <a href="/?sampleLarge=seuss-world" style={{ display: "block", marginTop: 8, color: T.accent, fontSize: 12 }}>Explore the large image sample ↗</a>
        </div>}
        {SAMPLE_PROMPTS.map((sample) => {
          const profile = AGENT_PROFILES[sample.agentMode];
          return (
            <button
              type="button"
              key={sample.title}
              onClick={() => {
                patchSession(sessionId, { agentMode: sample.agentMode, mode: "chat" });
                setDraftText(sessionId, sample.prompt);
                window.requestAnimationFrame(() => {
                  const textarea = document.querySelector<HTMLTextAreaElement>(
                    'textarea[placeholder="Message… (code, research, images — just ask)"]',
                  );
                  textarea?.focus();
                  textarea?.setSelectionRange(0, 0);
                  if (textarea) textarea.scrollTop = 0;
                });
              }}
              style={{ position: "relative", minHeight: 112, overflow: "hidden", padding: 0, borderRadius: T.radiusSm, border: `1px solid ${T.borderSoft}`, background: T.bgElev, color: T.text, cursor: "pointer", textAlign: "left" }}
            >
              <img src={sample.thumbnail} alt="" aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.34 }} />
              <span style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(11,11,13,0.05), rgba(11,11,13,0.95))" }} />
              <span style={{ position: "relative", display: "flex", height: "100%", minHeight: 112, flexDirection: "column", justifyContent: "flex-end", padding: 10 }}>
                <em style={{ alignSelf: "flex-start", marginBottom: 5, padding: "2px 6px", borderRadius: 99, background: T.accentSoft, color: T.accent, fontSize: 9.5, fontStyle: "normal", fontWeight: 800 }}>{profile.label}</em>
                <strong style={{ fontSize: 13 }}>{sample.title}</strong>
                <span style={{ marginTop: 2, color: T.textDim, fontSize: 11.25 }}>{sample.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
