<!-- The AI labelling server: settings, a one-image test, and a labelling run. -->
<script setup>
import { t, tHtml } from "@/i18n/index.js";
import { HINT } from "@/i18n/hints.js";
import { app, runTask, requestStop } from "@/stores/app.js";
import { ai, saveAiSettings, providerChanged, loadModels, testOne, runLlm, findOdd } from "@/stores/ai.js";
import BaseStatusLine from "@/components/BaseStatusLine.vue";

const label = () => runTask("AI labelling", "llm", () => runLlm(ai.n || 200), (err) => err);
const odd = () => runTask("AI odd ones", "llm", findOdd, (err) => err);
const origin = location.origin;
const onToggle = (e) => { if (e.target.open) loadModels(); };
</script>

<template>
  <details id="llmBox" @toggle="onToggle">
    <summary><b>{{ t("AI labelling server") }}</b> {{ t("(Ollama or OpenAI-compatible)") }}</summary>
    <div class="stack">
      <div class="row">
        <label class="f" for="llmProvider">{{ t("Type") }}
          <select id="llmProvider" v-model="ai.provider" @change="providerChanged"><option value="ollama">Ollama</option><option value="openai">{{ t("OpenAI-compatible") }}</option></select>
        </label>
        <label class="f" for="llmUrl">{{ t("Address") }} <input id="llmUrl" v-model="ai.url" type="text" class="wide" @change="saveAiSettings"></label>
        <label class="f" for="llmModel">{{ t("Model") }} <input id="llmModel" v-model="ai.model" type="text" list="llmModels" @change="saveAiSettings">
          <datalist id="llmModels"><option v-for="m in ai.models" :key="m" :value="m"></option></datalist>
        </label>
        <label class="f" for="llmKey">{{ t("API key") }} <input id="llmKey" v-model="ai.key" type="password" :placeholder="t('not needed for Ollama')" autocomplete="off" @change="saveAiSettings"></label>
        <button id="btnLlmTest" :disabled="!!app.busy" @click="testOne">{{ t("Test with one image") }}</button>
      </div>
      <p class="hint" v-html="tHtml('ollamaHint', 'Ollama has to allow this page: start it with <code>OLLAMA_ORIGINS={origin}</code> (and <code>OLLAMA_HOST=0.0.0.0</code> when it runs on another computer). With an online service, the images you label are sent to it, and the key is stored in this browser.', { origin })"></p>
      <p class="hint">{{ t("The images are spread over all wheels and readings: readings with the fewest usable labels go first, then one image per reading in turn, from different days. Disagreements are asked about before unconfirmed images.") }}</p>
      <div class="row">
        <label class="f" for="llmN" :data-hint="HINT.llmN">{{ t("Images to label") }} <input id="llmN" v-model.number="ai.n" type="number" min="1" step="10"></label>
        <button id="btnLlm" class="primary" :disabled="!!app.busy" @click="label">{{ t("Label with AI") }}</button>
        <button id="btnLlmStop" :disabled="app.task !== 'AI labelling' && app.task !== 'AI odd ones'" @click="requestStop">{{ t("Stop") }}</button>
      </div>
      <div class="row">
        <button id="btnLlmOdd" :disabled="!!app.busy" :data-hint="HINT.llmOdd" @click="odd">{{ t("Find odd images in groups") }}</button>
      </div>
      <BaseStatusLine id="llmStatus" where="llm" />
    </div>
  </details>
</template>
