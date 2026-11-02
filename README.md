# Meter model trainer

**English** · [Русский](README.ru.md)

Train a digit model for **your own meter** in the browser, straight from an
[AI-on-the-edge-device](https://github.com/jomjol/AI-on-the-edge-device) meter.

A single HTML page (`trainer.html.gz`, ~370 KB) that collects the digit images the device
saves, labels them, trains the digit model in the browser and installs the int8 `.tflite`
file the firmware loads. It is served from the device's SD card (`/html/trainer.html.gz`)
or opened from disk. There are no CDN links, so it works on a network without internet
access. No firmware changes are needed.

## Install

1. Download `trainer.html.gz` from the [latest release](../../releases/latest).
2. In the device's file manager, upload it to `/html/`.
3. Open `http://<device>/trainer.html`. The firmware caches the page for 12 h, so reload
   hard (Ctrl+F5) after updating it. The header badge says whether the page found the
   device; if it reads "not on a device", click it to see what was asked and what came back
   (the page asks `/statusflow` up to three times, 8 s each), and to check again.

Training runs on the GPU (WebGL): use a desktop browser. Labelling also works on a phone
(see "Save to the device" below). Collecting needs a few days of digit images saved by the
device (step 1 sets that up).

## What the page does (served from the device)

A wizard: Start (overview, automatic run) and five steps, each reachable at any time.

1. **Device setup:** reads `config.ini` and checks that digit images are saved
   (`ROIImagesLocation`) and kept long enough (`ROIImagesRetention`). One click fixes it:
   the config is backed up to `/config/config_<ts>.ini.bak`, pushed right after a reading
   round (MD5-checked) and the device restarts.
2. **Collect:** first a scan lists the new `/log/digit/<day>/<hour>/` folders (with a time estimate while it runs) and shows how many images there are to download and how long it takes; then crops go into IndexedDB ("Check and download" in the button's menu does both in one go). The device's
   reading is in each file name; crops are grouped by wheel + reading (digit, between two
   digits, rejected) and each group keeps "images per reading" (default 100) spread evenly
   over the hours it was seen, old and new days, day and night: a later collect fetches only
   what fills the new hours; nothing already collected is deleted. Resumable;
   finished hours are remembered. A labelled dataset zip can be imported too.
3. **Labels:** sources are the device reading, steady runs (≥4 identical readings), an AI
   server (Ollama `/api/chat` or OpenAI-compatible `/v1/chat/completions`) and your
   review. Two agreeing sources = confirmed. Only yours and confirmed labels train by
   default. A coverage table and readiness verdict show what is missing. The review grid
   has keyboard labelling and a touch layout for phones, marks the images the last model
   learned from (●), and explains with drawn examples how to label a wheel between two
   digits (one digit whole = that digit; both cut off = between).
4. **Train:** in a Web Worker (keeps running in a background tab). The test split is the
   newest ~20% of each wheel and label, so every label is tested, the in-between positions
   too; near-duplicates left out, at most 50 per wheel and label. Results per wheel and per
   label. Per wheel and label up to 300 images train, spread over time with
   near-duplicates left out; smaller groups are repeated (up to 4×) so each counts about as
   much. The new model is compared with the installed one on the same test images
   the device read, and only when there are at least 100 of them. The test images the new
   model got wrong are listed, the surest mistakes first (often a wrong label), and open in
   the review.
5. **Install:** uploads the model to `/config/`, switches `[Digits] Model` after a round,
   restarts the device, waits for the first reading; one-click undo. *Show its images* opens
   a page in a new tab with every image the model learned from and the test images, the
   comparison model's mistakes in red. The model can also be downloaded as a zip with the images it learned from, the test images and `index.html`,
   one page showing them all by label or by wheel and label.

An **automatic run** does 2–5 in a row and installs only when the new model is at least as
good on the same images.

**Save to the device / Load from the device** (Collect and Labels steps) keep the whole
state (images, labels, collected folders) on the SD card: `/config/trainer-state.zip`
(labels and the image list) plus the JPEGs in parts of up to 7 MB, as the device takes
files up to 8000 KB. Load it in another browser, a phone for example, and go on
labelling there. Loading adds the missing images and keeps the newer label of each image.

## Build

Node 22:

```bash
npm ci
npm run build          # -> dist/trainer.html and dist/trainer.html.gz
npm run check:i18n     # every English text has a Russian one
DEVICE=http://<device-ip> npm run dev   # dev server; proxies the device API
```

The firmware serves `trainer.html.gz` with `Content-Encoding: gzip` when `/trainer.html`
is requested, so only the `.gz` goes on the card.

## Releases

GitHub Actions builds every push and pull request (artifact `trainer-page`). Pushing a
tag `v<major>.<minor>.<patch>` builds with that version in the page header and publishes
a release with `trainer.html.gz` and `trainer.html`:

```bash
npm version 0.7.4      # sets package.json, commits, tags v0.7.4
git push --follow-tags
```

## Code layout

The page is Vue 3 (`<script setup>` single-file components, no store library):

```
src/
  main.js, App.vue   entry and shell (header, step rail, one section per step)
  views/             one screen per step: StartView … InstallView
  components/        Base* = generic parts (status line, log, progress bar, crop image);
                     labels/Labels*, train/Train* = parts of one view; StepPill, StepNav
  stores/            shared state + actions, no markup (see below)
  services/          outside the page: device HTTP API, IndexedDB (db.js), AI server,
                     the device image collector
  lib/               pure logic, also run by Node scripts: dataset, labels, readiness,
                     train set, model, TFLite exporter (lib/tflite/)
  workers/           train.worker.js: TensorFlow.js training off the main thread
  i18n/              t() / tHtml() (index.js), Russian texts (ru.js), hint texts (hints.js)
  plugins/           hintTooltip.js: the shared tooltip for [data-hint] elements
  utils/             formatting, md5
  assets/            main.css (all styles), fonts
```

- Stores: `app.js` holds the open step, the one running task (`runTask`), status lines
  and step pills; `project.js` the crops and labels; then one per step (`setup`,
  `collect`, `ai`, `review`, `train`, `install`, `auto`, `datasetExport`, `deviceState`,
  `modelExport`). Crops and
  labels are large, so `project.js` keeps them outside Vue's reactivity and bumps a
  `rev` counter when they change.
- Imports: `@/` (= `src/`) in components and stores; `lib/`, `services/`, `i18n/` and
  `utils/` import each other relatively, so Node scripts (`scripts/node-check.mjs`) can
  load them without Vite.

Text: `t("English text", vars)` everywhere, `tHtml(key, html)` for text with markup and
`N_("...")` for English kept in data; `node scripts/i18n-keys.mjs` lists what
`src/i18n/ru.js` is missing.

## Dataset zip

```
labels.csv     path,src,pos,label,split,ts
images/...     crop JPEGs (any size; resized to 20x32 with PIL-style bilinear)
```

`label` is a digit (`7`) or, for a rolling wheel between two digits, both digits (`7/8`,
trained as 0.5/0.5). `split` is `train` or `test`; the test crops are only used for
the results table. `scripts/make_dataset_zip.py` packs a dataset prepared elsewhere:

```bash
python scripts/make_dataset_zip.py dataset_meta.csv dataset.zip
```

## Model and export

- **Network:** the "small" preset matches the deployed f24 model (conv 24/48/48, dense 128/64, about 3 M multiply-adds per digit).
  - Each conv block is Conv3x3 → BatchNorm → LeakyReLU(0.3) → MaxPool.
  - BatchNorm and the input scale (1/255) are folded into the conv weights at export.
- **Export** (`src/lib/tflite/export.js` + `writer.js`): writes the TFLite flatbuffer directly.
  - Ops: QUANTIZE, CONV_2D, LEAKY_RELU, MAX_POOL_2D, RESHAPE, FULLY_CONNECTED, SOFTMAX, DEQUANTIZE. All are in `CTfLiteClass::MakeStaticResolver`.
  - Quantization: int8 per-channel conv weights, per-tensor FC weights, int32 biases, activations calibrated on 300 training crops.
  - Input and output stay float32, like the stock `dig-cont` models (DoubleHyprid10, 10 outputs).
- **File name:** `dig-cont_<yyyymmddhhmm>_f<filters>_n<images>_q.tflite` (UTC time, first
  conv layer's filters, images trained on), in the slot order of the stock models
  (`dig-cont_0900_s3_q.tflite`). Example: `dig-cont_202610161419_f24_n19359_q.tflite`.

## Checks

```bash
# exporter vs the official TFLite converter on the same Keras weights
# (Python with TensorFlow/Keras and ai_edge_litert; dataset.npz format in keras_ref.py)
python scripts/keras_ref.py --data dataset.npz --out check-out
node scripts/export-from-json.mjs check-out
python scripts/compare_tflite.py check-out

# the built page end to end in headless Edge/Chrome (WebGL)
node scripts/browser-check.mjs check-out/meters-dataset.zip check-out/browser_q.tflite 60
# device workflow, read-only on the device (never installs): run vite preview with DEVICE first
ZIP=check-out/meters-dataset.zip node scripts/ui-check.mjs http://localhost:4173/trainer.html 150 3 gemma4:12b
```

## Browser limits on `http://<device>` pages

These pages are not a secure context, so:
- No WebGPU: training uses WebGL.
- No folder picker: the project lives in browser storage, with zip files or "Save to the
  device" to move it.
- No `crypto.subtle`.
- WebAssembly runs single-threaded, because the firmware sends no COOP/COEP headers.
