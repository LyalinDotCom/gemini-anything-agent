import { T } from "../tokens";
import { Icon, IconButton } from "./atoms";

const REPO_URL = "https://github.com/LyalinDotCom/gemini-anything-agent/";

export function AboutPanel({ onClose }: { onClose: () => void }) {
  const parts = [
    ["Web + Electron", "Two chat surfaces with the same profiles, recovery, files, and previews."],
    ["Managed agent", "A hosted Linux workbench mounting the shared agents/ payload."],
    ["gai + Browser", "Published CLI launchers add media creation and real headless website testing."],
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 60, display: "grid", placeItems: "center" }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.64)" }} />
      <section role="dialog" aria-modal="true" aria-label="About Gemini Anything" style={{ position: "relative", width: "min(680px, calc(100vw - 28px))", maxHeight: "84vh", overflowY: "auto", padding: 20, borderRadius: T.radius, border: `1px solid ${T.border}`, background: T.bgElev }}>
        <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, display: "grid", placeItems: "center", color: T.accent, background: T.accentSoft }}><Icon name="sparkle" size={18} /></span>
          <div style={{ flex: 1 }}><h2 style={{ margin: 0, fontSize: 18 }}>Gemini Anything</h2><p style={{ margin: "3px 0 0", color: T.textFaint, fontSize: 12.5 }}>One agent payload, two complete apps.</p></div>
          <IconButton name="x" label="Close" onClick={onClose} />
        </header>
        <p style={{ color: T.textDim, lineHeight: 1.6, fontSize: 13.5 }}>A managed-agent prototype that keeps normal work native, uses a published CLI for media, and gives Browser mode a real Playwright-powered Linux browser. Artifacts stay under <code style={{ fontFamily: T.mono }}>/workspace/output</code> and sync into the app or a user-linked local folder.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 9 }}>
          {parts.map(([title, detail]) => <article key={title} style={{ padding: 13, borderRadius: T.radiusSm, border: `1px solid ${T.borderSoft}`, background: T.bg }}><strong style={{ fontSize: 13 }}>{title}</strong><p style={{ margin: "6px 0 0", color: T.textFaint, fontSize: 12, lineHeight: 1.45 }}>{detail}</p></article>)}
        </div>
        <a href={REPO_URL} target="_blank" rel="noreferrer" style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 7, color: T.accent, fontSize: 13, textDecoration: "none" }}><Icon name="globe" size={14} /> Open GitHub repository</a>
      </section>
    </div>
  );
}
