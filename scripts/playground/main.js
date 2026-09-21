/**
 * Browser playground entry. Bundled to docs/playground.js (GitHub Pages
 * serves docs/ with no build step). `typescript` stays on a pinned CDN.
 */
import { transform } from "../../packages/core/src/transform.ts";

export { transform };

const DEBOUNCE_MS = 150;

function compiledJavaScript(tsCode) {
  const typescript = globalThis.ts;
  if (!typescript || typeof typescript.transpileModule !== "function") {
    throw new Error(
      "The TypeScript compiler did not load. JavaScript output needs the pinned typescript CDN script.",
    );
  }
  return typescript.transpileModule(tsCode, {
    compilerOptions: {
      target: typescript.ScriptTarget.ESNext,
      module: typescript.ModuleKind.ESNext,
    },
  }).outputText;
}

function boot() {
  const sourceEl = document.getElementById("sts-source");
  const outputEl = document.getElementById("compiled-output");
  const modeEl = document.getElementById("output-mode");
  if (!(sourceEl instanceof HTMLTextAreaElement)) return;
  if (!(outputEl instanceof HTMLTextAreaElement)) return;
  if (!(modeEl instanceof HTMLFieldSetElement)) return;

  let timer = 0;

  function render() {
    const source = sourceEl.value;
    let tsCode;
    try {
      tsCode = transform(source).code;
    } catch (err) {
      outputEl.classList.add("is-error");
      outputEl.setAttribute("aria-invalid", "true");
      outputEl.value = err instanceof Error ? err.message : String(err);
      return;
    }

    const mode = modeEl.querySelector('input[name="output-lang"]:checked');
    try {
      const text =
        mode instanceof HTMLInputElement && mode.value === "js"
          ? compiledJavaScript(tsCode)
          : tsCode;
      outputEl.classList.remove("is-error");
      outputEl.removeAttribute("aria-invalid");
      outputEl.value = text;
    } catch (err) {
      outputEl.classList.add("is-error");
      outputEl.setAttribute("aria-invalid", "true");
      outputEl.value = err instanceof Error ? err.message : String(err);
    }
  }

  sourceEl.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(render, DEBOUNCE_MS);
  });

  modeEl.addEventListener("change", () => {
    render();
  });

  render();
}

if (typeof document !== "undefined") {
  boot();
}
