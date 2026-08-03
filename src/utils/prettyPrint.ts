// prettyPrint.ts
//
// Shared best-effort pretty-printer for request/response bodies shown in
// code-style displays (Flow Visualizer steps, HAR Analyzer payload/response
// panes, etc). Extracted so every code display in the app formats bodies
// the same way instead of each component reinventing it.

/**
 * Best-effort formatting for a raw body string:
 *   1. Valid JSON -> indented JSON.
 *   2. Looks like application/x-www-form-urlencoded (a=b&c=d) -> one
 *      "key: value" pair per line.
 *   3. Anything else (XML, plain text, HTML form snippets, etc.) -> returned
 *      unchanged; pair this with a `whitespace-pre-wrap break-all` container
 *      so long unbroken content still wraps instead of forcing horizontal
 *      scroll.
 */
export function prettyPrintBody(body: string | undefined | null): string {
  if (!body) return '';
  const trimmed = body.trim();
  if (!trimmed) return body;

  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    // not JSON
  }

  if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(trimmed)) {
    try {
      const params = new URLSearchParams(trimmed);
      const lines: string[] = [];
      params.forEach((v, k) => lines.push(`${k}: ${v}`));
      if (lines.length > 0) return lines.join('\n');
    } catch {
      // fall through to raw body
    }
  }

  return body;
}

/** True if `body` parses as JSON — useful for deciding whether to show a "JSON" badge etc. */
export function isJsonBody(body: string | undefined | null): boolean {
  if (!body) return false;
  try {
    JSON.parse(body.trim());
    return true;
  } catch {
    return false;
  }
}
