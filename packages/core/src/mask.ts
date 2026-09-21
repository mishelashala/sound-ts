/**
 * Offset-preserving mask of comments and string/template literals.
 * Used by the dialect scanner (discovery) and by text-based soundness bans.
 */

/**
 * Mask line comments (`//`), block comments, and `"…"`, `'…'`, `` `…` ``
 * literals with spaces (same length) so a subsequent scan cannot match inside
 * them while offsets still point into the original source.
 *
 * Template literals are masked as a single span (including any `${…}`); we do
 * not re-enter expression mode inside `${}`.
 */
export function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;

    // Line comment: // … to EOL (newline kept)
    if (c === "/" && source[i + 1] === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < source.length && source[i] !== "\n" && source[i] !== "\r") {
        out[i] = " ";
        i++;
      }
      continue;
    }

    // Block comment: /* … */
    if (c === "/" && source[i + 1] === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < source.length) {
        if (source[i] === "*" && source[i + 1] === "/") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          break;
        }
        if (source[i] !== "\n" && source[i] !== "\r") {
          out[i] = " ";
        }
        i++;
      }
      continue;
    }

    // Single- or double-quoted string
    if (c === '"' || c === "'") {
      const quote = c;
      out[i] = " ";
      i++;
      while (i < source.length) {
        const ch = source[i]!;
        if (ch === "\\") {
          out[i] = " ";
          if (i + 1 < source.length) {
            out[i + 1] = " ";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        out[i] = " ";
        i++;
        if (ch === quote) break;
      }
      continue;
    }

    // Template literal (plain span through closing backtick)
    if (c === "`") {
      out[i] = " ";
      i++;
      while (i < source.length) {
        const ch = source[i]!;
        if (ch === "\\") {
          out[i] = " ";
          if (i + 1 < source.length) {
            out[i + 1] = " ";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        out[i] = " ";
        i++;
        if (ch === "`") break;
      }
      continue;
    }

    i++;
  }
  return out.join("");
}
