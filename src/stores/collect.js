// Step 2: list the device's image folders, download the chosen crops, import a dataset zip.
import { markRaw, reactive } from "vue";
import { unzip } from "fflate";
import { decodeBrowser, parseCsv, IN_W, IN_H } from "@/lib/dataset.js";
import { resizeBilinear } from "@/lib/resize.js";
import * as store from "@/services/db.js";
import { scan, download, groupOf } from "@/services/collector.js";
import { t } from "@/i18n/index.js";
import { app, say } from "@/stores/app.js";
import { data, refreshProject } from "@/stores/project.js";
import { fmtTime, num } from "@/utils/format.js";

export const FILES_PER_S = 3; // what an ESP32-CAM serves, until a download of this browser measured it
const SPEED_MIN_IMAGES = 20, SPEED_MIN_SECONDS = 10; // shorter runs are too noisy to remember

export const collect = reactive({
  days: 7,
  quota: 100,    // images kept per wheel + device reading (spread over time)
  plan: null,    // result of the last check (scan), until downloaded
  bar: 0,        // progress 0..1
  speed: null,   // {rate, n, at}: the average images/s of the last long enough download, kept in this browser
});

/** The speed the estimate uses: measured by the last download here, else the usual device rate. */
export const filesPerSec = () => collect.speed?.rate || FILES_PER_S;

export async function loadCollectSpeed() {
  collect.speed = await store.kvGet("collectSpeed");
}

/** Remembers the average speed of a finished download, whole-run wall time included. */
async function rememberSpeed(res) {
  const n = res.fetched + res.failed;
  if (n < SPEED_MIN_IMAGES || res.seconds < SPEED_MIN_SECONDS) return;
  const speed = { rate: n / res.seconds, n, at: Date.now() };
  collect.speed = speed;
  await store.kvSet("collectSpeed", speed);
}

/** Crops already stored per download group (wheel + device reading). */
function cropsByGroup() {
  const m = new Map();
  for (const c of data.crops) if (c.pred != null) { const g = groupOf(c.roi, c.pred, c.rejected); if (!m.has(g)) m.set(g, []); m.get(g).push(c); }
  return m;
}
const haveByGroup = () => new Map([...cropsByGroup()].map(([g, cs]) => [g, cs.map((c) => c.ts)]));

export async function runScan() {
  if (!app.onDevice) { say("collect", t("Collecting needs the page to be opened from the device."), true); return null; }
  say("collect", t("Listing the device's image folders…"));
  let t0 = 0; // when the hour folders started listing: the ETA is the average so far
  const plan = await scan({
    days: collect.days || 7, quota: collect.quota || 100, have: haveByGroup(), shouldStop: () => app.stop,
    onProgress: (p) => {
      t0 ||= performance.now();
      const secPer = p.listed ? (performance.now() - t0) / 1000 / p.listed : 0;
      const eta = p.listed >= 2 ? " · " + t("about {time} left", { time: fmtTime((p.total - p.listed) * secPer) }) : "";
      say("collect", t("Listing folder {i} of {n} ({folder})…", { i: p.listed + 1, n: p.total, folder: p.folder }) + eta);
      collect.bar = p.listed / Math.max(1, p.total);
      app.progress = t("checking {i}/{n}", { i: p.listed, n: p.total });
    },
  });
  collect.bar = 0;
  collect.plan = markRaw(plan);
  say("collect", plan.complete ? t("Checked {n} new hour folders in {time}", { n: plan.listed, time: fmtTime(plan.listSeconds) }) +
    (plan.fromCache ? t(" ({n} remembered from an earlier check)", { n: plan.fromCache }) : "") + "." : t("Check stopped early; the numbers cover the folders listed so far."));
  return plan;
}

export async function runDownload() {
  if (!collect.plan) await runScan();
  const plan = collect.plan;
  if (!plan?.toFetch) return;
  await store.persist();
  const res = await download(plan, {
    shouldStop: () => app.stop,
    onProgress: (p) => {
      const left = p.total - p.fetched - p.failed, frac = (p.fetched + p.failed) / Math.max(1, p.total);
      collect.bar = frac;
      say("collect", t("{i} of {n} downloaded", { i: num(p.fetched), n: num(p.total) }) + (p.failed ? t(", {n} failed", { n: p.failed }) : "") +
        " · " + t("{n} images/s", { n: p.rate.toFixed(1) }) + " · " + t("about {time} left", { time: fmtTime(left / Math.max(0.1, p.rate)) }));
      app.progress = t("collecting {p}%", { p: Math.round(frac * 100) });
    },
  });
  say("collect", t(app.stop ? "Stopped: {n} new images" : "Done: {n} new images", { n: num(res.fetched) }) + (res.failed ? t(", {n} could not be read", { n: res.failed }) : "") + ".");
  await rememberSpeed(res);
  collect.plan = null;
  await refreshProject();
}

export async function runCollect() { await runScan(); if (!app.stop) await runDownload(); }

/** Per wheel: images to download, skipped, readings full and readings still short. */
export function perWheel(plan, quota) {
  const w = new Map();
  for (const [g, v] of plan.groups) {
    const [roi, lab] = g.split("|");
    const e = w.get(roi) || { roi, picked: 0, skipped: 0, full: 0, open: 0 };
    e.picked += v.picked; e.skipped += v.available - v.picked;
    if (v.have + v.picked >= quota) e.full++; else if (lab !== "rejected") e.open++;
    w.set(roi, e);
  }
  return [...w.values()].sort((a, b) => a.roi.localeCompare(b.roi, undefined, { numeric: true }));
}

/** Imports a dataset zip: plain ones (every label counts as yours) or exports from this page. */
export async function importZip(f) {
  say("collect", t("Reading {file}…", { file: f.name }));
  const buf = new Uint8Array(await f.arrayBuffer());
  const files = await new Promise((res, rej) => unzip(buf, (err, out) => (err ? rej(err) : res(out))));
  if (!files["labels.csv"]) throw new Error(t("labels.csv is missing from the zip"));
  const rows = parseCsv(new TextDecoder().decode(files["labels.csv"])).filter((r) => r.label || r.human || r.llm || r.device);
  const rich = rows.length && "status" in rows[0];
  let batch = [], labels = [], n = 0;
  const flush = async () => { await store.putCrops(batch); await store.putLabels(labels); n += batch.length; batch = []; labels = []; };
  for (const r of rows) {
    const bytes = files[r.path]; if (!bytes) continue;
    try {
      const im = await decodeBrowser(bytes);
      const id = `zip/${f.name}/${r.path}`;
      const roi = r.roi || (r.src ? `${r.src}.dig${r.pos}` : `dig${r.pos}`);
      const pred = rich && r.device !== "" ? +r.device : null;
      batch.push({ crop: { id, roi, ts: r.ts || "00000000-000000", pred, rejected: rich && r.rejected === "1", w: im.width, h: im.height,
        pix: resizeBilinear(im.data, im.width, im.height, IN_W, IN_H, 4) }, jpeg: bytes });
      const rec = { id };
      if (!rich) rec.human = r.label;
      else { if (r.human) rec.human = r.human; if (r.llm) { rec.llm = r.llm; rec.llmModel = r.llm_model || "import"; } }
      labels.push(rec);
    } catch { /* skip unreadable */ }
    if (batch.length >= 200) { await flush(); say("collect", t("Imported {i} of {n}…", { i: n, n: rows.length })); }
  }
  if (batch.length) await flush();
  say("collect", t("Imported {n} labelled images from {file}.", { n, file: f.name }));
  await refreshProject();
}

export async function clearAll() {
  await store.clearAll();
  collect.speed = null;
  await refreshProject();
  say("collect", t("All data in this browser deleted."));
}
