/**
 * Browser playground entry. Bundled to docs/playground.js (GitHub Pages
 * serves docs/ with no build step). `typescript` and Prism stay on pinned CDNs.
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

/** Clone Prism TypeScript and mark brand / validate / cast as keywords. */
function ensureStsGrammar() {
  const Prism = globalThis.Prism;
  if (!Prism?.languages?.typescript) return null;
  if (Prism.languages.sts) return Prism.languages.sts;

  Prism.languages.sts = Prism.languages.extend("typescript", {});
  Prism.languages.insertBefore("sts", "keyword", {
    "dialect-keyword": {
      pattern: /\b(?:brand|validate|cast)\b/,
      alias: "keyword",
    },
  });
  return Prism.languages.sts;
}

function highlightInto(codeEl, source, language) {
  const Prism = globalThis.Prism;
  if (!(codeEl instanceof HTMLElement)) return;

  // Trailing newline keeps caret/scroll alignment with the textarea.
  const text = source.endsWith("\n") ? source : `${source}\n`;

  if (!Prism?.highlight || !Prism.languages?.[language]) {
    codeEl.textContent = text;
    return;
  }

  codeEl.className = `language-${language}`;
  codeEl.innerHTML = Prism.highlight(text, Prism.languages[language], language);
}

function setOutputError(outputEl, codeEl, message) {
  outputEl.classList.add("is-error");
  outputEl.setAttribute("aria-invalid", "true");
  codeEl.className = "";
  codeEl.textContent = message;
}

function setOutputCode(outputEl, codeEl, text, language) {
  outputEl.classList.remove("is-error");
  outputEl.removeAttribute("aria-invalid");
  highlightInto(codeEl, text, language);
}

function boot() {
  const sourceEl = document.getElementById("sts-source");
  const highlightEl = document.getElementById("sts-highlight");
  const highlightPre = highlightEl?.closest("pre");
  const outputEl = document.getElementById("compiled-output");
  const codeEl = document.getElementById("compiled-code");
  const modeEl = document.getElementById("output-mode");
  if (!(sourceEl instanceof HTMLTextAreaElement)) return;
  if (!(highlightEl instanceof HTMLElement)) return;
  if (!(highlightPre instanceof HTMLElement)) return;
  if (!(outputEl instanceof HTMLElement)) return;
  if (!(codeEl instanceof HTMLElement)) return;
  if (!(modeEl instanceof HTMLFieldSetElement)) return;

  ensureStsGrammar();

  let timer = 0;

  function syncHighlightScroll() {
    highlightPre.scrollTop = sourceEl.scrollTop;
    highlightPre.scrollLeft = sourceEl.scrollLeft;
  }

  function highlightSource() {
    highlightInto(highlightEl, sourceEl.value, "sts");
    syncHighlightScroll();
  }

  function render() {
    highlightSource();

    const source = sourceEl.value;
    let tsCode;
    try {
      tsCode = transform(source).code;
    } catch (err) {
      setOutputError(
        outputEl,
        codeEl,
        err instanceof Error ? err.message : String(err),
      );
      return;
    }

    const mode = modeEl.querySelector('input[name="output-lang"]:checked');
    const asJs = mode instanceof HTMLInputElement && mode.value === "js";
    try {
      const text = asJs ? compiledJavaScript(tsCode) : tsCode;
      setOutputCode(outputEl, codeEl, text, asJs ? "javascript" : "typescript");
    } catch (err) {
      setOutputError(
        outputEl,
        codeEl,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  sourceEl.addEventListener("input", () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(render, DEBOUNCE_MS);
  });

  sourceEl.addEventListener("scroll", syncHighlightScroll);

  modeEl.addEventListener("change", () => {
    render();
  });

  render();
}

if (typeof document !== "undefined") {
  boot();
}
