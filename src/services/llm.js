// Ask a vision model what a crop shows. Two API styles:
//   ollama  POST {url}/api/chat                (local Ollama; set OLLAMA_ORIGINS to allow this page)
//   openai  POST {url}/v1/chat/completions     (OpenAI, LM Studio, llama.cpp server, vLLM, ...)
// Answers are one vote in lib/labels.js, never the final word: models that read slow wheels
// well can still be poor on a rolling last wheel.
import { t } from "../i18n/index.js";

export const PROMPT =
  "This is a crop of ONE digit wheel of a mechanical rolling meter counter. " +
  "Parts of the neighbouring digits above and below may be visible because the wheel rotates. " +
  "Reply with the single digit (0-9) whose body is closest to the vertical centre of the image. " +
  "If the wheel is exactly halfway between two digits, reply with both, lower first, like 3/4 " +
  "(9/0 for the 9-to-0 transition). If you cannot read it, reply N. Reply with nothing else.";

/** Odd-one-out in a strip of k crops of one wheel that should all look alike. */
export const oddPrompt = (k) =>
  `The image shows ${k} crops of the same digit wheel of a mechanical rolling meter counter, numbered 1 to ${k} above each crop. ` +
  "Most of them show the wheel in the same position. Which crops show a different digit or position than the majority? " +
  "Reply with only a JSON array of their numbers, [] if all of them show the same.";

/** The numbers in a JSON array answer, or null when there is none. */
export function parseNumbers(text) {
  const m = (text || "").match(/\[[^\]]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]).map(Number).filter(Number.isInteger); } catch { return null; }
}

export function parseAnswer(text) {
  const s = (text || "").trim();
  const m = s.match(/\b(\d)\s*\/\s*(\d)\b/);
  if (m) return `${m[1]}/${m[2]}`;
  const d = s.match(/\d/);
  return d ? d[0] : "N";
}

/** JPEG bytes -> base64 JPEG upscaled to >= 128 px high (small crops read poorly). */
export async function encodeCrop(bytes, minH = 128) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  const s = Math.max(1, Math.ceil(minH / bmp.height));
  const c = new OffscreenCanvas(bmp.width * s, bmp.height * s);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return toBase64(c);
}

/** Crops side by side, each 128 px high, numbered 1..n above (for oddPrompt). */
export async function encodeStrip(list, h = 128) {
  const bmps = await Promise.all(list.map((b) => createImageBitmap(new Blob([b], { type: "image/jpeg" }))));
  const w = Math.round((bmps[0].width / bmps[0].height) * h), pad = 6, top = 26;
  const c = new OffscreenCanvas(pad + bmps.length * (w + pad), top + h + pad);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#000"; ctx.font = "18px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "top";
  bmps.forEach((b, i) => {
    const x = pad + i * (w + pad);
    ctx.drawImage(b, x, top, w, h);
    ctx.fillText(String(i + 1), x + w / 2, 4);
    b.close();
  });
  return toBase64(c);
}

async function toBase64(c) {
  const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

const trimUrl = (u) => u.replace(/\/+$/, "").replace(/\/v1$/, "");

/** settings: {provider, url, model, key}; returns {answer, raw, seconds} (raw: the whole reply when a prompt is given) */
export async function ask(settings, b64, timeoutMs = 120000, prompt = PROMPT) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = performance.now();
  try {
    let r, raw;
    if (settings.provider === "ollama") {
      r = await fetch(`${trimUrl(settings.url)}/api/chat`, {
        method: "POST", signal: ctl.signal, headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: settings.model, stream: false, think: false,
          messages: [{ role: "user", content: prompt, images: [b64] }],
          options: { temperature: 0, num_predict: 1500 } }),
      });
      if (!r.ok) throw new Error(t("Ollama answered HTTP {status}: {body}", { status: r.status, body: (await r.text()).slice(0, 160) }));
      raw = (await r.json()).message?.content || "";
    } else {
      const headers = { "Content-Type": "application/json" };
      if (settings.key) headers.Authorization = `Bearer ${settings.key}`;
      r = await fetch(`${trimUrl(settings.url)}/v1/chat/completions`, {
        method: "POST", signal: ctl.signal, headers,
        body: JSON.stringify({ model: settings.model, temperature: 0, max_tokens: 1500,
          messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } }] }] }),
      });
      if (!r.ok) throw new Error(t("Server answered HTTP {status}: {body}", { status: r.status, body: (await r.text()).slice(0, 160) }));
      raw = (await r.json()).choices?.[0]?.message?.content || "";
    }
    return { answer: parseAnswer(raw), raw: prompt === PROMPT ? raw.slice(0, 80) : raw, seconds: (performance.now() - t0) / 1000 };
  } catch (e) {
    if (e.name === "AbortError") throw new Error(t("no answer within {n} s", { n: timeoutMs / 1000 }));
    if (e instanceof TypeError) throw new Error(blockedHint(settings));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** A failed fetch (TypeError) is usually the server refusing this page's origin. */
export function blockedHint(s) {
  const origin = location.origin;
  if (s.provider === "ollama") {
    return t("The browser could not reach Ollama at {url}. Start Ollama with OLLAMA_ORIGINS={origin} (or *) set, and OLLAMA_HOST=0.0.0.0 if it runs on another computer; then restart Ollama. Chrome may also ask to allow access to devices on your local network.", { url: s.url, origin });
  }
  return t("The browser could not reach {url}. The server must allow requests from {origin} (CORS); in LM Studio enable “CORS”, for llama.cpp server start it with --cors-origin or similar.", { url: s.url, origin });
}

/** List models (Ollama /api/tags or /v1/models) to fill the model picker. */
export async function listModels(settings) {
  try {
    if (settings.provider === "ollama") {
      const r = await fetch(`${trimUrl(settings.url)}/api/tags`);
      return (await r.json()).models.map((m) => m.name);
    }
    const headers = settings.key ? { Authorization: `Bearer ${settings.key}` } : {};
    const r = await fetch(`${trimUrl(settings.url)}/v1/models`, { headers });
    return (await r.json()).data.map((m) => m.id);
  } catch (e) {
    if (e instanceof TypeError) throw new Error(blockedHint(settings));
    throw e;
  }
}
