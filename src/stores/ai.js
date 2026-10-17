// Step 3: labels from an AI server (Ollama or OpenAI-compatible).
import { reactive } from "vue";
import * as llm from "@/services/llm.js";
import * as store from "@/services/db.js";
import { groupOf } from "@/services/collector.js";
import { MIN_PER_DIGIT } from "@/lib/readiness.js";
import { t } from "@/i18n/index.js";
import { app, say } from "@/stores/app.js";
import { data, refreshProject, setLabelFields } from "@/stores/project.js";

export const ai = reactive({
  provider: "ollama",
  url: "http://localhost:11434",
  model: "gemma4:12b",
  key: "",
  n: 200,          // images to label in one run
  models: [],      // offered in the model field
});
const settings = () => ({ provider: ai.provider, url: ai.url.trim(), model: ai.model.trim(), key: ai.key });

export async function loadAiSettings() {
  const s = await store.kvGet("llm");
  if (s) Object.assign(ai, { provider: s.provider, url: s.url, model: s.model, key: s.key || "" });
}
export const saveAiSettings = () => store.kvSet("llm", settings());

/** Switching the type puts in that type's usual address. */
export function providerChanged() {
  if (ai.provider === "ollama" && !/11434/.test(ai.url)) ai.url = "http://localhost:11434";
  if (ai.provider === "openai" && /11434/.test(ai.url)) ai.url = "https://api.openai.com";
  saveAiSettings();
}

export async function loadModels() {
  try { ai.models = await llm.listModels(settings()); } catch { /* shown on test */ }
}

// Which images to ask the AI about. The budget is spread over wheels and readings: images
// are grouped like the collector does (wheel + device reading), groups with the fewest
// usable labels go first, and each round takes one image per group (random within the
// group, so different days and times of day). Disagreements come before unconfirmed
// images within a group; already confirmed ones only when budget is left.
const AI_TARGET = MIN_PER_DIGIT; // usable labels per group before the AI moves on
function llmQueue(limit) {
  const model = settings().model;
  const rank = { conflict: 0, unconfirmed: 1, confirmed: 2 };
  const key = (c) => (c.pred != null ? groupOf(c.roi, c.pred, c.rejected) : `${c.roi}|${data.eff.get(c.id)?.label ?? "?"}`);
  const usable = new Map(), groups = new Map();
  for (const c of data.crops) {
    const e = data.eff.get(c.id); if (!e) continue;
    const k = key(c);
    if (e.status === "human" || e.status === "confirmed") usable.set(k, (usable.get(k) || 0) + 1);
    const r = data.labels.get(c.id);
    if (r?.human || (r?.llm && r.llmModel === model) || !(e.status in rank)) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  for (const list of groups.values()) {
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    list.sort((a, b) => rank[data.eff.get(a.id).status] - rank[data.eff.get(b.id).status]); // stable: random within a status
  }
  const order = [...groups.keys()].sort((a, b) => (usable.get(a) || 0) - (usable.get(b) || 0));
  const out = [], taken = new Map();
  for (const pass of ["needed", "rest"]) {
    let added = true;
    while (out.length < limit && added) {
      added = false;
      for (const k of order) {
        if (out.length >= limit) break;
        const list = groups.get(k), n = taken.get(k) || 0;
        if (n >= list.length) continue;
        if (pass === "needed" && ((usable.get(k) || 0) + n >= AI_TARGET || rank[data.eff.get(list[n].id).status] === 2)) continue;
        out.push(list[n]); taken.set(k, n + 1); added = true;
      }
    }
  }
  out.groups = taken.size;
  out.wheels = new Set(out.map((c) => c.roi)).size;
  return out;
}

export async function testOne() {
  const c = llmQueue(1)[0] || data.crops[0];
  if (!c) { say("llm", t("Collect images first."), true); return; }
  say("llm", t("Asking…"));
  try {
    const r = await llm.ask(settings(), await llm.encodeCrop(await store.getJpeg(c.id)));
    say("llm", t("Works: answered “{a}” for a {roi} image in {s} s (device read {d}).", { a: r.answer, roi: c.roi, s: r.seconds.toFixed(1), d: c.pred ?? "–" }));
  } catch (e) { say("llm", e.message, true); }
}

export async function runLlm(limit) {
  const s = settings();
  await saveAiSettings();
  const q = llmQueue(limit);
  if (!q.length) { say("llm", t("Nothing left to ask about.")); return; }
  say("llm", t("Asking about {n} images from {w} wheels and {g} different readings…", { n: q.length, w: q.wheels, g: q.groups }));
  const t0 = performance.now();
  let done = 0, failed = 0;
  for (const c of q) {
    if (app.stop) break;
    try {
      const r = await llm.ask(s, await llm.encodeCrop(await store.getJpeg(c.id)));
      await setLabelFields(c, { llm: r.answer, llmModel: s.model });
      done++;
    } catch (e) {
      failed++;
      if (failed >= 3 && done === 0) throw e;
    }
    const per = (performance.now() - t0) / 1000 / (done + failed);
    say("llm", t("{i} of {n} labelled", { i: done, n: q.length }) + (failed ? t(", {n} failed", { n: failed }) : "") +
      t(", {s} s each, about {m} min left", { s: per.toFixed(1), m: Math.ceil(((q.length - done - failed) * per) / 60) }));
    app.progress = t("AI labels {i}/{n}", { i: done, n: q.length });
  }
  say("llm", t(app.stop ? "Stopped: {n} images from {w} wheels and {g} readings labelled by {model}" : "Done: {n} images from {w} wheels and {g} readings labelled by {model}",
    { n: done, w: q.wheels, g: q.groups, model: s.model }) + (failed ? t(", {n} failed", { n: failed }) : "") + ".");
  await refreshProject();
}

// Odd ones out: the crops of one wheel shown with the same label should all look alike. The
// model gets them as numbered strips of up to ODD_STRIP and names the ones unlike the rest;
// every crop goes through ODD_PASSES strips with different neighbours, and only a crop named
// every time is marked (one strip alone names a few too many). A marked label becomes a
// disagreement and goes to the review. Your own labels are never checked.
const ODD_STRIP = 8, ODD_PASSES = 3, ODD_MIN = 4;
const shuffled = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** Groups (wheel + shown label) with their crops to check; groups with crops not yet checked by this model first. */
function oddGroups(model) {
  const groups = new Map();
  for (const c of data.crops) {
    const e = data.eff.get(c.id);
    if (!e?.label || !(e.status === "confirmed" || e.status === "unconfirmed" || (e.status === "conflict" && data.labels.get(c.id)?.odd))) continue;
    const k = `${c.roi}|${e.label}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  }
  const fresh = (c) => { const r = data.labels.get(c.id); return !(r?.oddModel === model && r.oddFor === data.eff.get(c.id).label); };
  return [...groups.entries()].filter(([, cs]) => cs.length >= ODD_MIN && cs.some(fresh))
    .map(([key, crops]) => ({ key, crops })).sort((a, b) => b.crops.filter(fresh).length - a.crops.filter(fresh).length);
}

export async function findOdd() {
  const s = settings();
  await saveAiSettings();
  const groups = oddGroups(s.model);
  if (!groups.length) { say("llm", t("No group to check: every group of 4 or more images was checked by {model}.", { model: s.model })); return; }
  const total = groups.reduce((n, g) => n + g.crops.length, 0);
  say("llm", t("Checking {n} images in {g} groups for odd ones…", { n: total, g: groups.length }));
  let done = 0, marked = 0, failed = 0;
  for (const g of groups) {
    if (app.stop) break;
    const jpeg = new Map(await Promise.all(g.crops.map(async (c) => [c.id, await store.getJpeg(c.id)])));
    const crops = g.crops.filter((c) => jpeg.get(c.id));
    const named = new Map(crops.map((c) => [c.id, 0]));
    for (let pass = 0; pass < ODD_PASSES && !app.stop; pass++) {
      const order = shuffled(crops), n = Math.ceil(order.length / ODD_STRIP), size = Math.ceil(order.length / n);
      for (let i = 0; i < order.length && !app.stop; i += size) {
        const strip = order.slice(i, i + size);
        try {
          const r = await llm.ask(s, await llm.encodeStrip(strip.map((c) => jpeg.get(c.id))), 120000, llm.oddPrompt(strip.length));
          const nums = llm.parseNumbers(r.raw);
          if (!nums) { failed++; continue; } // no answer: counts as not named
          for (const k of nums) if (strip[k - 1]) named.set(strip[k - 1].id, named.get(strip[k - 1].id) + 1);
        } catch (e) {
          failed++;
          if (failed >= 3 && !done) throw e;
        }
      }
    }
    if (app.stop) break;
    const label = g.key.split("|")[1];
    for (const c of crops) {
      const odd = named.get(c.id) >= ODD_PASSES;
      marked += odd;
      await setLabelFields(c, { odd: odd || null, oddFor: label, oddModel: s.model });
    }
    done += crops.length;
    say("llm", t("{i} of {n} images checked, {m} odd ones", { i: done, n: total, m: marked }) + (failed ? t(", {n} failed", { n: failed }) : ""));
    app.progress = t("odd ones {i}/{n}", { i: done, n: total });
  }
  say("llm", t(app.stop ? "Stopped: {n} images checked by {model}, {m} odd ones sent to the review as disagreements" : "Done: {n} images checked by {model}, {m} odd ones sent to the review as disagreements",
    { n: done, model: s.model, m: marked }) + (failed ? t(", {n} failed", { n: failed }) : "") + ".");
  await refreshProject();
}
