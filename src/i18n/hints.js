// Short explanations shown when pointing at (or focusing) a status word, a table heading or
// a setting. Any element with data-hint="..." shows them (plugins/hintTooltip.js).
import { MIN_PER_DIGIT, MIN_PER_TRANSITION, MIN_COMPARE } from "../lib/readiness.js";
import { t } from "./index.js";


/** Hint for a step's status word (the pill next to the title and in the step bar). */
export function pillHint(id, text) {
  const en = pillHintEn(id, text);
  return en ? t(en, { min: MIN_PER_DIGIT, trans: MIN_PER_TRANSITION, cmp: MIN_COMPARE }) : "";
}
function pillHintEn(id, text) {
  if (!text || text === "–") return "";
  const k = text.toLowerCase();
  switch (id) {
    case "autoPill":
      return "Where each step stands. Click a step to open it.";
    case "setupPill":
      return {
        checking: "Reading the device’s configuration…",
        ready: "The device saves its digit images and keeps them long enough to train on.",
        check: "Training works, but a setting below needs a look, for example images that are deleted after a few days.",
        "action needed": "The device does not save digit images yet. Fix the red item below first.",
        "not on a device": "This page was not opened from a meter, so it cannot collect images or install a model. Importing a dataset and training still work.",
      }[k] || "";
    case "collectPill":
      return k === "empty" ? "No images in this browser yet: check for new images, then download them."
        : "Digit images stored in this browser so far. They stay here after a reload.";
    case "labelsPill":
      return {
        "ready to train": "Every digit 0–9 has at least {min} usable images, rolling wheels have {trans} of each in-between position, and the images span 2 or more days.",
        "not enough yet": "Some digits have fewer than {min} usable images (or in-between positions fewer than {trans}), or all images come from one day. You can still train, but the model will be weaker on what is missing. The line under the table lists it.",
      }[k] || "";
    case "trainPill":
      return {
        "new model ready": "On the same test images, the new model reads at least as well as the model installed now.",
        "not better": "On the same test images, the new model reads worse than the installed one. Installing it would make readings worse: label or collect more, then train again.",
        "not compared": "Fewer than {cmp} test images were read by the device itself, so the two models cannot be compared fairly. Collect more days.",
      }[k] || "";
    case "installPill":
      if (k === "no model yet") return "Train a model in step 4 first.";
      if (k === "installed") return "The device now reads with the new model. If readings get worse, go back to the previous model below.";
      return "The last trained model. It is kept in this browser until you train another.";
  }
  return "";
}

/** Hints for words that are fixed in the page or in generated tables. */
export const HINT = {
  // train chart
  trainLoss: t("How wrong the model is on the images it learns from. It should keep falling."),
  valLoss: t("How wrong it is on images held back from learning. If it rises while training loss keeps falling, the model is memorising; the page keeps the epoch where this was lowest."),
  // coverage table (Labels)
  wheel: t("One digit position on the meter, named as in the device’s configuration. ↻ marks a rolling wheel that often stops between two digits."),
  images: t("Images of this wheel stored in this browser."),
  days: t("How many different days these images come from. More days means more kinds of light."),
  usable: t("Images training uses: labelled by you, or two sources agree (for example the device and the AI)."),
  toReview: t("Images with only one source, or whose sources disagree. Not used for training until you check them."),
  digit: (l) => (l.includes("/") ? t("Usable images where the wheel stands between {a} and {b}.", { a: l.split("/")[0], b: l.split("/")[1] }) : t("Usable images labelled {l}.", { l })),
  // collect plan table
  toDownload: t("Images chosen for download: the newest of their reading."),
  skipped: t("Images left on the device: their reading already has as many newer images here."),
  readingsFull: t("Readings (wheel + what the device read) that reach “images per reading” after this download."),
  readingsShort: t("Readings that still have fewer than “images per reading”, even after this download. More days would help."),
  // compare table (Train)
  testImages: t("Each wheel’s newest days (or newest 20% of its images), held back from training for this comparison, with a usable label."),
  newModel: t("Share of the test images the new model reads correctly."),
  deviceNow: t("Share the installed model got right on the test images it read itself (its reading is in the file name)."),
  between: t("Test images where the wheel stands between two digits."),
  newModelBetween: t("Share of those the new model reads as either of the two digits."),
  // settings
  daysBack: t("How many days of the device’s image folders to look at."),
  deviceState: t("One file on the device's SD card ({file}) with the images and labels of this browser. Save here, load in another browser (a phone, say) and go on labelling there; loading adds what is missing and keeps the newer label of each image.", { file: "/config/trainer-state.zip" }),
  llmOdd: t("The AI looks at the images of each wheel shown with the same label, eight at a time, and names the ones unlike the rest, three times with different neighbours. An image named every time becomes a disagreement, so you check it in the review. It does not read the digits, so it is fast; your own labels are left alone."),
  perReading: t("Images kept per wheel and device reading (for example dig3 reading 7): the newest ones. A wheel at rest shows the same digit for days, so most of its images are not needed."),
  modelSize: t("Bigger models can be a little more accurate but take longer to read each digit on the device."),
  epochs: t("How many times training goes through all images. The page keeps the epoch with the lowest validation loss, so more is safe, only slower."),
  batch: t("Images per training step. Larger is faster on a GPU; the default suits most cases."),
  lr: t("How big each learning step is. Too high and training jumps around; too low and it is slow."),
  finalAll: t("The comparison needs a model that has not seen the test images. The model you install does not: training it again on all images uses the newest days too, which matters most for a wheel added recently."),
  llmN: t("How many images to send to the AI server this time. They are spread over all wheels and readings."),
  show: t("Needs review: one source, or sources disagree. Disagreements: the device and the AI read different digits. Not approved by you: everything you have not labelled yourself. Usable: what training uses. Labelled by you: your own labels."),
};

/** Hint for an image tile in the review grid, by label status. */
export const statusHint = {
  human: t("Labelled by you. Used for training."),
  confirmed: t("Two sources agree. Used for training."),
  unconfirmed: t("Only one source. Not used for training until you approve it."),
  conflict: t("The sources disagree. Pick the right digit."),
  excluded: t("Marked unusable by you. Left out of training."),
  none: t("No label yet."),
};
