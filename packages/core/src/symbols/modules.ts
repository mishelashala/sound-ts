/**
 * Resolve relative module specifiers against filenames in the transform batch.
 * Not a full Node/TS resolver — only what `transformProject` needs for linking
 * stock companion imports to dialect symbols.
 */

/**
 * Map `from "./a.js"` (relative to `fromFile`) onto a batch filename, if any.
 */
export function resolveBatchModule(
  fromFile: string,
  specifier: string,
  filenames: ReadonlySet<string>,
): string | undefined {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return undefined;
  }

  const fromNorm = normalizePath(fromFile);
  const fromDir = dirnamePosix(fromNorm);
  const joined = normalizePath(joinPosix(fromDir, specifier));

  const candidates = expandCandidates(joined);
  for (const c of candidates) {
    if (filenames.has(c)) return c;
  }

  // Basename fallback: fixtures often use bare `a.sts` + `./a.js`
  const base = basenamePosix(joined).replace(/\.(js|ts|sts|mts|cts)$/, "");
  for (const f of filenames) {
    const fb = basenamePosix(f).replace(/\.(js|ts|sts|mts|cts)$/, "");
    if (fb === base) return f;
  }
  return undefined;
}

function expandCandidates(joined: string): string[] {
  const out = new Set<string>([joined]);
  if (/\.(js|mjs|cjs)$/.test(joined)) {
    const stem = joined.replace(/\.(js|mjs|cjs)$/, "");
    out.add(`${stem}.sts`);
    out.add(`${stem}.ts`);
    out.add(`${stem}.mts`);
    out.add(`${stem}.cts`);
    out.add(stem);
  } else if (!/\.(sts|ts|mts|cts)$/.test(joined)) {
    out.add(`${joined}.sts`);
    out.add(`${joined}.ts`);
  }
  return [...out];
}

function normalizePath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  // Preserve leading "./" style only as relative path without drive
  return stack.join("/");
}

function dirnamePosix(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

function basenamePosix(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}

function joinPosix(dir: string, rel: string): string {
  if (!dir) return rel.replace(/^\.\//, "");
  const r = rel.startsWith("./") ? rel.slice(2) : rel;
  return `${dir}/${r}`;
}
