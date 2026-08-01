# Enhancement Guide: SAML Tools — Broader Improvements

## Overview

This document is a companion to [`fix-guide-saml-tools.md`](./fix-guide-saml-tools.md).
Where that guide covers **bugs to fix** (truncated output, missing DEFLATE support,
misleading errors, etc.), this one covers **capabilities to add** on top of a fixed
foundation — turning the SAML Tools section from "paste XML, see indented XML" into
something that actually helps someone reason about a SAML exchange.

Nothing here requires reworking the fix guide's chunk plan or the
[HAR-to-Flow Reconstruction guide](./enhancement-har-flow-reconstruction.md). These
are additive, later chunks that build on top once the decode pipeline is solid.

**Status:** Fix guide Chunks 1–9 are complete. Of this document's chunks, 10 and 11
are implemented (see below); 12–17 are still idea/design-only.

---

## Cross-cutting note found during this review

`XswSimulator.tsx` (a separate component, not one of the SAML Tools tabs) also calls
`xmlService.formatXml()` to render its "Original SAML" panel. It has the exact same
truncated-bracket bug described in the fix guide's Chunk 1. Worth remembering:
**fixing `formatXml` fixes two components, not one.**

---

## Ideas (Ranked by Likely Value)

### **1. Structured "Assertion Summary" card** ⭐⭐⭐⭐⭐ — ✅ **Already implemented**
**Why it matters:** Most people opening a decoded SAML response don't want to read
indented XML — they want five facts: Issuer, Subject/NameID, Audience,
Destination/ACS, and the validity window (`NotBefore`/`NotOnOrAfter`).

**Idea:** A summary card above the raw XML output, parsed straight out of the
decoded document. Raw XML stays available underneath for anyone who wants it — this
doesn't replace the current view, it adds a friendlier default.

**Status:** Present in `SamlTools.tsx` as the "SAML Summary" card (Inspector tab),
populated by `parseSamlSummary()`.

---

### **2. Attribute table, extracted and readable** ⭐⭐⭐⭐⭐ — ✅ **Implemented**
**Why it matters:** Given the Pega use case leans heavily on attribute mapping
(role, operator ID, etc. — see the HAR-to-Flow guide), a clean name/value table
pulled from `<saml:AttributeStatement>` is probably the single highest-value addition
for actual day-to-day debugging, more so than any XML-reading feature.

**Idea:** Table view, same visual language as the rest of the toolkit (see
`JsonViewer` used elsewhere for decoded JWT payloads) — copy-individual-value support
would be a nice small addition here too.

**Status:** `parseSamlSummary()` now extracts `<saml:Attribute>` (Name/FriendlyName +
joined `AttributeValue`s, with a non-namespaced fallback) and renders it as a table
appended to the SAML Summary card, with a hover-to-reveal per-row copy button.

---

### **3. Validation checklist (not just algorithm dump)** ⭐⭐⭐⭐
**Why it matters:** The current Sig Analyzer reports *what algorithm* was used but
not *whether the assertion is trustworthy right now*. That's a meaningfully different
and more useful question.

**Idea:** A checklist in the same visual language `services/har.ts` already uses for
its `securityIssues` array (✅ / ⚠️ rows) — covering: signature present, assertion not
expired, audience matches (if the user supplies their SP entity ID), destination
matches the ACS URL, etc. This is a natural extension of the *existing* Sig Analyzer
tab, not a new one.

---

### **4. Real signature verification** ⭐⭐⭐⭐
**Why it matters:** Sig Analyzer currently only inspects signature *structure*
(canonicalization method, algorithm, presence of KeyInfo) — it never actually
verifies the signature is valid.

**Idea:** Let the user paste or select an IdP certificate (there's already a
`CertificateAnalyzer.tsx` and `KeyManager` component in the toolkit — this could
reuse cert-parsing logic from there) and verify the XML-DSig signature via WebCrypto.
This is a bigger lift than the others here — good candidate for its own standalone
chunk rather than bundling with smaller items.

---

### **5. SAML diff view** ⭐⭐⭐
**Why it matters:** `TokenDiff.tsx` already exists and is a proven pattern for
comparing two JWTs side by side.

**Idea:** A "SAML Diff" using the same comparison UI — useful for comparing two
assertions/requests, e.g. before/after an IdP config change, or expected vs. actual.
Low risk since it reuses an existing, working component pattern rather than inventing
a new one.

---

### **6. History instead of one shared blob** ⭐⭐⭐
**Why it matters:** HAR files already get IndexedDB storage with a switcher UI
(`harStorage.ts`), and JWTs get their own storage (`jwtStorage.ts`). SAML currently
has none of that — just one `localStorage` string shared across all five tabs (also
flagged in the fix guide as Issue #5).

**Idea:** A small "recent SAML documents" list, reusing the same storage pattern
already proven elsewhere in the app, so pasting a new response doesn't just silently
overwrite the last one being examined.

---

### **7. Paste-the-whole-request support** ⭐⭐⭐
**Why it matters:** Right now the user has to manually extract just the
`SAMLResponse=...` value from a raw HTTP POST body or browser dev tools before
pasting it in.

**Idea:** Accept a full pasted HTTP request/response and auto-extract the relevant
parameter — similar in spirit to how `curlParser.ts` already parses full cURL
commands elsewhere in the toolkit. Also a nice, lighter-weight complement to the full
Flow Visualizer pipeline from the HAR-to-Flow guide — someone could paste a single
HAR entry's body directly into SAML Tools without going through flow detection at
all.

---

### **8. Encoding-path breadcrumb** ⭐⭐
**Why it matters:** Once the shared decode pipeline from the fix guide (Chunk 3/4)
exists, it's worth surfacing what it actually detected, not just showing the result.

**Idea:** A small chip trail — "Base64 → Inflate → XML" — above the decoded output.
Doubles as a debugging aid and reinforces the toolkit's educational bent (explaining
*why* something decoded the way it did, not just showing the end result).

---

## Suggested Sequencing

These are written as Chunks 10+ to sit after the fix guide's existing Chunks 1–9
without renumbering anything already planned there.

| Chunk | Scope | Depends on | Status |
|---|---|---|---|
| **10. Assertion Summary card** | Parse and display Issuer/Subject/Audience/Destination/validity window. | Fix guide Chunk 1 (needs correctly-formatted/parsed XML to extract from) | ✅ Done |
| **11. Attribute table** | Extract and render `<saml:AttributeStatement>` as a table. | Fix guide Chunk 1 | ✅ Done |
| **12. Validation checklist** | Extend Sig Analyzer with pass/fail checks beyond algorithm reporting. | Fix guide Chunk 2 (accurate parse-error handling) | Not started |
| **13. SAML Diff view** | New comparison view modeled on `TokenDiff.tsx`. | Fix guide Chunk 1 | Not started |
| **14. History / storage** | Reuse `harStorage.ts`/`jwtStorage.ts` pattern for SAML documents. | none — independent | Not started |
| **15. Paste-whole-request extraction** | Auto-extract `SAMLRequest`/`SAMLResponse` from a full pasted HTTP message. | none — independent | Not started |
| **16. Encoding-path breadcrumb** | Surface detected decode path in the UI. | Fix guide Chunk 3 (shared decode pipeline) | Not started |
| **17. Real signature verification** | WebCrypto-based XML-DSig verification against a supplied certificate. | Fix guide Chunk 1; likely reuses `CertificateAnalyzer`/`KeyManager` logic | Not started |

**Suggested starting point once the fix guide's Chunk 1 lands:** ~~Chunk 11 (attribute
table)~~ — done. Chunk 16 (encoding-path breadcrumb) is now unblocked too, since the
fix guide's Chunk 3/4 (shared decode pipeline + DEFLATE) both landed alongside this
work — it's a small UI-only addition on top of `decodeSamlInput()`'s existing
`detected` label. Otherwise, next logical pick is Chunk 12 (validation checklist),
which only needed Chunk 2 (also done).

---

## Open Questions

- For Chunk 4/17 (real signature verification), is there an existing preferred
  certificate source (paste PEM, upload, or pull from IdP metadata already loaded
  elsewhere in the toolkit), or should all three be supported?
- For Chunk 14 (history), same retention/storage questions as the HAR guide raised —
  worth deciding once, consistently, across both features rather than solving it
  twice.
- Chunk 15 (paste-whole-request) and the HAR-to-Flow Reconstruction feature both
  involve pulling SAML content out of a larger captured payload — worth checking
  whether they can eventually share extraction logic once both exist, to avoid two
  slightly different implementations of the same parsing step.

---

*Document created as a design reference before implementation. Chunks 10 and 11 have
since been implemented; see the Status notes above. Chunks 12–17 remain design-only.*
