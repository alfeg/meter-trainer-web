// Effective label of each crop from the available evidence:
//   human      set on the review page                       always wins ("x" = unusable)
//   device     the device model's reading (crop file name)  not a vote when it was rejected
//   steady     the same device reading for >= STEADY rounds in a row (a wheel at rest)
//   llm        a vision model's answer (Ollama / OpenAI-compatible)
//   odd        a vision model found the crop unlike the others of its wheel shown with the
//              same label (a strip of them, checked three times): no answer of its own, but
//              it sends the label to the review as a disagreement
// Two agreeing sources = "confirmed" (trained on). A single source = "unconfirmed",
// disagreement = "conflict": both go to the review queue and are not trained on unless
// the user says so; training on the device's own readings would repeat its mistakes.

export const STEADY = 4;
export const LABELS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0/1", "1/2", "2/3", "3/4", "4/5", "5/6", "6/7", "7/8", "8/9", "9/0"];

/** Device reading 0..9.99 -> "7", or "7/8" when the wheel sits between digits. */
export function predLabel(pred) {
  const v = ((pred % 10) + 10) % 10;
  const f = v - Math.floor(v);
  if (f >= 0.3 && f <= 0.7) { const a = Math.floor(v); return `${a}/${(a + 1) % 10}`; }
  return String(Math.round(v) % 10);
}
export const labelPos = (l) => (l.includes("/") ? +l.split("/")[0] + 0.5 : +l);
const dist = (a, b) => { const d = Math.abs(labelPos(a) - labelPos(b)) % 10; return Math.min(d, 10 - d); };
export const agree = (a, b) => dist(a, b) <= 0.5;

/** crops sorted or not; returns Map id -> steady label for crops inside a steady run. */
export function steadyLabels(crops) {
  const byRoi = new Map();
  for (const c of crops) {
    if (c.pred == null) continue;
    if (!byRoi.has(c.roi)) byRoi.set(c.roi, []);
    byRoi.get(c.roi).push(c);
  }
  const out = new Map();
  for (const items of byRoi.values()) {
    items.sort((a, b) => (a.ts < b.ts ? -1 : 1));
    let run = [];
    const flush = () => { if (run.length >= STEADY) run.forEach((c) => out.set(c.id, predLabel(run[0].pred))); run = []; };
    for (const c of items) {
      const l = c.rejected ? null : predLabel(c.pred);
      if (!l || l.includes("/")) { flush(); continue; }
      if (run.length && predLabel(run[0].pred) !== l) flush();
      run.push(c);
    }
    flush();
  }
  return out;
}

/**
 * -> {label, status, sources, score}; score orders the review queue (low first).
 * status: human | confirmed | unconfirmed | conflict | excluded | none
 */
export function effective(crop, rec, steady) {
  const e = evidence(crop, rec, steady);
  if (rec?.odd && rec.oddFor === e.label && (e.status === "confirmed" || e.status === "unconfirmed")) {
    return { label: e.label, status: "conflict", sources: "AI: odd one out", score: 0.15 };
  }
  return e;
}

function evidence(crop, rec, steady) {
  if (rec?.human) {
    return rec.human === "x" ? { label: null, status: "excluded", sources: "you", score: 2 }
      : { label: rec.human, status: "human", sources: "you", score: 2 };
  }
  const dev = crop.pred != null && !crop.rejected ? predLabel(crop.pred) : null;
  const st = steady?.get(crop.id) || null;
  const llm = rec?.llm && rec.llm !== "N" ? rec.llm : null;
  if (dev && llm) {
    return agree(dev, llm) ? { label: dev, status: "confirmed", sources: "device + LLM", score: 1 }
      : { label: dev, status: "conflict", sources: `device ${dev} vs LLM ${llm}`, score: 0.1, alt: llm };
  }
  if (st && dev) return { label: dev, status: "confirmed", sources: "device, steady", score: 0.9 };
  if (llm) return { label: llm, status: "unconfirmed", sources: "LLM only", score: 0.4 };
  if (dev) return { label: dev, status: "unconfirmed", sources: "device only", score: 0.5 };
  if (crop.pred != null) return { label: predLabel(crop.pred), status: "unconfirmed", sources: "device (rejected)", score: 0.2 };
  return { label: null, status: "none", sources: "no label", score: 0 };
}

/** One-hot / two-hot training target for a label. */
export function target(label) {
  const y = new Float32Array(10);
  if (label.includes("/")) { const [a, b] = label.split("/").map((t) => +t % 10); y[a] = 0.5; y[b] += 0.5; } else y[+label % 10] = 1;
  return y;
}
