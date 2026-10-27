// Learning Materials — driver training on multi-apping and protecting your £/hour.
// Lazy-loaded from the profile so ten languages of prose stay out of the first-paint bundle.
// Read-only: it renders LEARN and nothing else, so it can't affect any app state.
import { LEARN } from "./learn";
import { B, M } from "./App.jsx";
import { LEARN_LABELS } from "./learnLabels";

export default function LearnScreen({ lang, onBack }) {
  const d = LEARN[lang] || LEARN.en;
  const rtl = !!((LEARN_LABELS[lang] || {}).rtl);
  const card = { background:"var(--card)", border:"1px solid var(--border)", borderRadius:14, padding:"14px 16px", marginBottom:10 };

  return (
    <div dir={rtl ? "rtl" : "ltr"} style={{ padding:"20px 16px 100px", textAlign: rtl ? "right" : "left" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4, flexDirection: rtl ? "row-reverse" : "row" }}>
        <button onClick={onBack} style={{ background:"none", border:"none", color:"#00b8a9", cursor:"pointer", fontSize:28, padding:0, lineHeight:1 }}>{rtl ? "›" : "‹"}</button>
        <div style={{ ...B, fontSize:28, color:"#00b8a9", letterSpacing:1 }}>{d.title}</div>
      </div>
      <div style={{ ...M, fontSize:13, color:"var(--muted)", marginBottom:18, lineHeight:1.5 }}>{d.subtitle}</div>

      {d.sections.map((s, i) => (
        <div key={i} style={card}>
          <div style={{ ...B, fontWeight:700, fontSize:15, color:"var(--ink)", marginBottom:8, lineHeight:1.35 }}>{s.h}</div>

          {[s.p, s.p2].map((block, k) => block && block.length ? (
            <div key={k}>
              {(Array.isArray(block) ? block : [block]).map((t, j) => (
                <div key={j} style={{ ...M, fontSize:13, color:"var(--muted)", lineHeight:1.6, marginBottom:8 }}>{t}</div>
              ))}
            </div>
          ) : null)}

          {s.ul && s.ul.length > 0 && (
            <div style={{ marginBottom: s.note ? 8 : 0 }}>
              {s.ul.map((t, j) => (
                <div key={j} style={{ display:"flex", gap:9, marginBottom:6, flexDirection: rtl ? "row-reverse" : "row" }}>
                  <span style={{ color:"#00b8a9", flexShrink:0, fontSize:13, lineHeight:1.6 }}>•</span>
                  <span style={{ ...M, fontSize:13, color:"var(--muted)", lineHeight:1.6 }}>{t}</span>
                </div>
              ))}
            </div>
          )}

          {/* The one line worth remembering from the section. */}
          {s.note && (
            <div style={{ background:"var(--tint-green)", border:"1px solid #06c16744", borderRadius:10, padding:"10px 12px", marginTop:2 }}>
              <span style={{ ...M, fontWeight:700, fontSize:12.5, color:"#06c167", lineHeight:1.55 }}>{s.note}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
