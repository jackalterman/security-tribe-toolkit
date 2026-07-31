# Fix & Enhancement Guide: SAML Tools

## Overview

This document catalogs the issues found during a review of `src/components/SamlTools.tsx`
and `src/services/xmlService.ts` — the "SAML Tools" section (Inspector, Response Gen,
Request Gen, Metadata, Sig Analyzer). It's written as a companion to the
[HAR-to-Flow Reconstruction guide](./enhancement-har-flow-reconstruction.md), same
"chunked build" philosophy: fix the highest-impact, self-contained bug first, then
work outward.

No code changes have been made yet — this is the analysis and plan only.

---

## 🚨 Confirmed Bugs (Ranked by Impact)

### **1. `formatXml()` truncates every single output** ⭐⭐⭐⭐⭐
**File:** `services/xmlService.ts`
**Why it matters:** This fires on 100% of decodes/generations, unconditionally.

**The bug:**
```js
formatXml(xml: string): string {
  let formatted = '';
  ...
  xml.split(/>\s*</).forEach(function(node) {
    ...
    formatted += indent + '<' + node + '>\r\n';
    ...
  });
  return formatted.substring(1, formatted.length - 3); // <-- the bug
}
```
The loop correctly rebuilds each tag as `<node>`, so the accumulated string always
starts with `<` (the root element's opening bracket) and always ends with `>\r\n`
(the last element's closing bracket + line break). The final `.substring(1, length-3)`
strips those off **unconditionally, on every call** — not per-node, but off the whole
result.

**Visible effect:** every pretty-printed document is missing its opening `<` on the
first line and its closing `>` on the last line. E.g. `<samlp:Response ...>` renders
as `samlp:Response ...>`, and `</samlp:Response>` renders as `</samlp:Response`.

**Fix approach:** Remove the blind `substring()` trim entirely — it appears to be a
leftover attempt to strip something that isn't actually there (there's no artificial
leading/trailing content added outside the loop to begin with). Add a test with a
small SAML snippet to lock in correct round-tripping before touching anything else in
this file.

---

### **2. No DEFLATE support for HTTP-Redirect binding** ⭐⭐⭐⭐⭐
**File:** `SamlTools.tsx` (`handleInspect`)
**Why it matters:** This is a functional gap, not a cosmetic one — real-world
redirect-bound SAML messages simply won't decode.

**The bug:** `handleInspect()` only attempts base64-decode and URL-decode:
```js
if (!xml.startsWith('<') && xml.length > 20) {
  try { const decoded = atob(xml); if (decoded.trim().startsWith('<')) xml = decoded; } catch (e) { }
}
if (xml.includes('%3C')) { try { xml = decodeURIComponent(xml); } catch(e) {} }
```
Per the SAML spec, the HTTP-Redirect binding requires messages to be **DEFLATE
(raw, no zlib header)-compressed**, then base64-encoded, then URL-encoded. This is
the standard encoding for most `AuthnRequest`s and some IdPs' responses. Since this
code never inflates, `atob()` succeeds but yields compressed binary, doesn't start
with `<`, and the message is treated as invalid or passed through as garbage.

**Fix approach:** Add a DEFLATE/INFLATE step. Browser-native `DecompressionStream`
(`'deflate-raw'`) is available in modern browsers and needs no dependency; `pako` is
the common fallback if broader browser support is needed. Detection order should be:
try raw XML → try base64 → try base64 + inflate → try URL-decode + base64 + inflate
(covers both POST binding, plain base64, and redirect binding).

---

### **3. Misleading error message when XML fails to parse** ⭐⭐⭐⭐
**File:** `SamlTools.tsx` (`handleAnalyzeSignature`)

**The bug:**
```js
const doc = parser.parseFromString(xml, "text/xml");
const signature = doc.getElementsByTagNameNS(...)[0];
if (!signature) { setSigAnalysis({ error: "No <ds:Signature> found in document." }); return; }
```
`DOMParser` never throws on malformed XML — it returns a document containing a
`<parsererror>` node instead. So when decoding fails (e.g. the DEFLATE case above, a
truncated paste, or genuinely non-XML input), the tool reports **"No signature
found"** instead of the real problem: "this input isn't valid XML." That's actively
misleading for debugging.

**Fix approach:** After parsing, check for `doc.getElementsByTagName('parsererror').length > 0`
(or `doc.documentElement.nodeName === 'parsererror'`) and surface a distinct,
accurate error: "Input could not be parsed as XML — check that it's fully decoded
(see Inspector tab)." This should also point the user toward Chunk 2/Bug #2 above if
relevant.

---

## 🛠 Structural Issues (Ranked by Impact)

### **4. Duplicated, inconsistent decode logic** ⭐⭐⭐
`handleInspect()` and `handleAnalyzeSignature()` each hand-roll their own decode
attempt instead of sharing one function. `handleInspect` tries URL-decoding;
`handleAnalyzeSignature` doesn't. Same pasted input, different behavior depending on
which tab it's used in.

**Fix approach:** Extract a single `decodeSamlInput(raw: string): { xml: string, steps: string[] }`
in `xmlService.ts` that both handlers call — try (in order) raw XML → base64 → base64
+ inflate → URL-decode variants of each. Return which decode path succeeded so the UI
can show it ("Detected: Base64 + DEFLATE (Redirect binding)"), which also doubles as
a nice diagnostic/educational touch consistent with the rest of the toolkit.

---

### **5. One shared `rawXml` state across all five tabs** ⭐⭐⭐
All five sub-views (Inspector, Response Gen, Request Gen, Metadata, Sig Analyzer)
read/write the same persisted `saml-raw-xml` state. Generating a mock Response,
Request, or Metadata document silently overwrites whatever was pasted into the
Inspector or Sig Analyzer — no isolation between "generating" and "inspecting"
workflows. Easy to lose pasted input by switching tabs or clicking Generate.

**Fix approach:** Give each tab its own input state (`inspectorInput`,
`sigAnalyzerInput`, and keep a separate `generatedOutput` for the three generator
tabs), OR keep one shared field but make it explicit — e.g. a confirmation before
overwriting non-empty content, or a visible "this will replace your current input"
cue.

---

## 🎨 Cosmetic / Polish Issues

### **6. No real syntax highlighting despite implying it** ⭐⭐⭐
**File:** `components/CodeBlock.tsx`

`CodeBlock` accepts a `language` prop and renders `<code className="language-xml">`,
but there's no highlighter library (Prism, highlight.js, etc.) actually wired up —
the class does nothing. Output is plain monospace text with zero visual distinction
between tags, attributes, and values. For dense, deeply-nested signed XML, this makes
the output meaningfully harder to scan than it should be — and it directly compounds
Bug #1, since a highlighted view would have made the missing `<`/`>` far more obvious
during development.

**Fix approach:** Add a lightweight client-side highlighter (e.g. `prism-react-renderer`
or a small hand-rolled XML tokenizer/regex highlighter to avoid a heavy dependency,
consistent with the toolkit's "no backend, all local" philosophy) and apply it when
`language="xml"`.

### **7. No line-wrapping on the "standard" `CodeBlock` variant** ⭐⭐
The `standard` variant (used for `prettyXml`) uses `overflow-x-auto` with no
`whitespace-pre-wrap`, so long attribute values (certificates, long redirect URLs)
require horizontal scrolling instead of wrapping. The `output` variant already
handles this correctly (`whitespace-pre-wrap break-all`) — worth using the same
treatment here, or offering a wrap toggle.

### **8. Dead/incomplete example loader** ⭐
`loadExample()`'s type signature includes `'google' | 'okta' | 'auth0'`, but only
`'google'` and `'okta'` are implemented, and there's no button wired up for Auth0 in
the UI at all. Either finish it or remove it from the type/UI to avoid the
appearance of a broken feature.

### **9. Signature analyzer only ever reports the first `<ds:Signature>`** ⭐⭐
`doc.getElementsByTagNameNS(..., "Signature")[0]` always grabs the first signature
in document order. Many real IdPs sign the `Assertion` only (not the top-level
`Response`), and some sign both — in the double-signed case, the second signature's
algorithm info is silently never shown, with no indication a second one exists.

**Fix approach:** Enumerate *all* `<ds:Signature>` elements, label each by its parent
context (`Response`-level vs `Assertion`-level), and render one card per signature
found instead of assuming exactly one.

---

## Build Plan (chunked)

| Chunk | Scope | Depends on |
|---|---|---|
| **1. Fix `formatXml` truncation** | Remove the blind `substring()` trim; add a round-trip test with a real SAML snippet. Smallest possible fix, immediately visible improvement. | none |
| **2. Fix misleading Sig Analyzer error** | Detect `parsererror` and report accurately. Small, self-contained. | none |
| **3. Shared decode pipeline** | Extract `decodeSamlInput()` in `xmlService.ts` (raw → base64 → URL-decode combinations); wire both Inspector and Sig Analyzer to it. | Chunk 1 (so decoded output actually displays correctly once shared) |
| **4. DEFLATE / Redirect-binding support** | Add inflate step to the shared decode pipeline; surface which encoding was detected in the UI. | Chunk 3 |
| **5. Per-tab input isolation** | Split `rawXml` into per-tab state, or add an overwrite guard. | none — can happen anytime, independent of the others |
| **6. Syntax highlighting** | Wire up a lightweight XML highlighter in `CodeBlock`. | Chunk 1 (no point highlighting output that's still missing brackets) |
| **7. Wrap long lines in standard `CodeBlock`** | Match the `output` variant's wrapping behavior. | none |
| **8. Multi-signature support** | Enumerate all `<ds:Signature>` elements, label by context. | Chunk 2 |
| **9. Finish or remove Auth0 example** | Small cleanup. | none |

**Suggested starting point:** Chunk 1. It's a one-line-ish fix, has zero dependencies,
and will immediately make every other tab look noticeably more correct — worth doing
before anything else so subsequent chunks are tested against correctly-formatted
output rather than the current broken baseline.

---

## Open Questions

- How commonly does real-world input include HTTP-Redirect-bound (DEFLATE-compressed)
  messages in practice for your use cases? If it's rare, Chunk 4 can drop in priority
  below the cosmetic fixes.
- Preference on the highlighter approach for Chunk 6 — pull in a small library
  (`prism-react-renderer` is React-friendly and tree-shakeable) vs. a hand-rolled
  regex tokenizer to keep the dependency footprint at zero, matching the rest of the
  toolkit's local-only, no-backend design.
- For Chunk 5 (state isolation), preference between fully separate state per tab vs.
  a shared field with an overwrite confirmation — the former is cleaner but a bigger
  diff; the latter is a smaller, more surgical change.

---

*Document created as a design/fix reference before implementation. No code changes
have been made to the project yet.*
