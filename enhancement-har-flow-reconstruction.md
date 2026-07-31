# Enhancement Guide: HAR-to-Flow Reconstruction

## Overview

Connect the **HAR Analyzer** and **Flow Visualizer** so that when a HAR file contains
a captured SSO exchange (SAML or OAuth2/OIDC), the user can click a button and see
that *real* login sequence rendered in the Flow Visualizer — real URLs, real hostnames,
real (redacted-if-needed) tokens/assertions — instead of the generic mocked walkthrough
it shows today.

This turns the Flow Visualizer from a **teaching tool** ("here's how OIDC works in
general") into a **forensics/debugging tool** ("here's exactly what happened in this
specific login, step by step").

### Fixed constraint driving the design
The Service Provider / Client side of every flow we care about is **always Pega**.
The Identity Provider varies (Okta, Microsoft Entra, Keyforge, and others not yet seen).
This means detection only needs to solve for *one* unknown side per flow, not two —
the Pega side can be recognized with high confidence using patterns we already have
in the codebase (`PEGA_COOKIES` in `HarAnalyzer.tsx`), and the IdP side is derived
generically from whatever the HAR actually shows rather than a hardcoded list.

---

## Why this is worth building

- **Existing detection groundwork.** `services/har.ts` already tags every entry with
  `analysis.authType` (`SAML`, `OAuth2`, `Bearer`, `Basic`) during parsing.
- **Existing visualization groundwork.** `FlowVisualizer.tsx` already has step-generator
  functions (`getOauthSteps`, `getSamlSteps`, `getDeviceSteps`) that produce an ordered
  array of steps with titles, descriptions, and detail payloads — currently filled with
  placeholder data (`CLIENT_123`, `AUTH_CODE_XYZ`).
- **Existing cross-component pattern.** `App.tsx` already pipes data between tools via
  the `onSendToDecoder` + `activeView` pattern (used by JWT Encoder, Key Manager,
  Failure Simulator, HAR Analyzer). The same mechanism can carry a reconstructed flow
  into the Flow Visualizer.

In short: three of the four building blocks already exist in some form. The missing
piece is the **correlation layer** that groups individual HAR entries into one coherent,
ordered flow.

---

## Architecture

### New module: `services/harFlowDetector.ts`
Pure function(s) that take a parsed `HarRoot` and return zero or more reconstructed
flows:

```ts
type FlowKind = 'oauth-oidc' | 'saml' | 'device';

interface RealFlowStep {
  title: string;
  description: string;
  request?: { method: string; url: string; headers: HarHeader[]; body?: string };
  response?: { status: number; headers: HarHeader[]; body?: string };
  captured: boolean; // false = we know this step happened but didn't see it in the HAR (e.g. server-side token exchange)
}

interface DetectedFlow {
  id: string;
  kind: FlowKind;
  confidence: 'high' | 'medium' | 'low';
  spHost: string;          // always the Pega host in our use case
  idpHost: string;         // observed IdP host
  idpDisplayName: string;  // "Okta" / "Microsoft" / raw hostname if unrecognized
  issuer?: string;         // from JWT `iss` or SAML <Issuer>
  steps: RealFlowStep[];
  sourceEntryIds: string[];
  startedAt: string;
}

function detectFlows(har: HarRoot): DetectedFlow[]
```

### Detection algorithm (Pega-anchored)

1. **Find the SP boundary.** Scan entries for `PEGA_COOKIES` matches and/or Pega URL
   fragments (`/prweb/`, `PRAuth`, `PRRestService`, `PRServlet` — exact ACS/callback
   path should be confirmed against a real Pega HAR, since it can vary by deployment
   config, e.g. `/prweb/<Application>/PRAuth`).
2. **Walk outward in timestamp order** from that boundary to find a redirect to a
   different host — this is the IdP candidate (`/authorize`, `/sso`, SAML redirect
   binding, etc.).
3. **Classify the flow kind** using the existing `authType` tags: presence of
   `SAMLRequest`/`SAMLResponse` → SAML; presence of `code=` + `state=` → OAuth2/OIDC;
   `device_authorization`/polling pattern → Device Flow.
4. **Correlate the return leg** using whichever anchor the protocol provides:
   - OAuth2/OIDC: match `state` between the `/authorize` redirect and the callback.
   - SAML: match `RelayState` if present, else fall back to timestamp ordering.
5. **Fill in what's visible, mark what isn't.** The client-secret token exchange
   (`POST /token` with `client_secret`) is a server-to-server call and will usually be
   *absent* from a browser-captured HAR. Steps we infer but didn't capture get
   `captured: false` and render as a grayed-out step ("occurred server-side, not
   visible in this HAR") rather than being skipped or shown with fake data.
6. **Extract IdP identity generically, not from a hardcoded list.**
   - OIDC: decode any JWT (`jwtService` already does this) and read the `iss` claim.
   - SAML: base64-decode the `SAMLResponse`/`SAMLRequest` and read `<saml:Issuer>`.
     This requires a new small parser — `xmlService.ts` currently only *generates*
     mock SAML XML, it has no `parseSamlResponse()` counterpart yet.
   - Match the resulting hostname against a small cosmetic fingerprint table
     (`*.okta.com` → Okta styling/colors, `login.microsoftonline.com` → Microsoft
     styling) purely for branding. No match → generic "Unknown IdP" badge showing the
     real hostname (e.g. Keyforge, or whatever shows up next). The flow still
     reconstructs correctly either way — branding is decoration, not a dependency.

### `FlowVisualizer.tsx` changes
- Accept an optional prop, e.g. `initialFlowData?: DetectedFlow`.
- When present, skip the mocked `getOauthSteps`/`getSamlSteps` generators and render
  the real `steps[]` instead — same UI chrome (step navigator, protocol insight panel,
  "Inspect Token" button), real data underneath.
- The Client/SP node can be hardcoded to render as **"Pega"** (dedicated icon/color)
  whenever driven by real HAR data — no need to detect SP identity, we already know it.
- The Auth node renders the resolved IdP display name/branding from the detected flow.
- Demo/mock mode (today's behavior) stays the default when no real data is passed in —
  still useful for the "Learn" section.

### `HarAnalyzer.tsx` changes
- Run `detectFlows()` once a HAR is loaded (alongside existing per-entry analysis).
- Where a flow is found, show a small banner/button — "View this login flow in the
  Flow Visualizer" — reusing the same navigation pattern as `onSendToDecoder`
  (set flow data in `App.tsx` state, switch `activeView` to `AppView.FLOWS`).
- If multiple flows are detected in one HAR (e.g. a login + a later re-auth), show a
  short picker instead of guessing: "2 flows detected — SAML SSO @ 14:02 (Okta),
  OIDC re-auth @ 14:47 (Keyforge)."

---

## Use Case: what the user actually sees

**Scenario:** A support engineer captures a HAR while reproducing a customer's failed
Pega login through Okta, and uploads it to the toolkit.

1. **Upload.** They drag `customer-repro.har` into the HAR Analyzer, same as today.
   Parsing runs, the entry table populates, and the existing per-row `authType` pill
   already shows `SAML` next to two of the requests.

2. **Detection banner appears.** Above the entry table, a new banner shows up:

   > 🔗 **1 SSO flow detected** — SAML login via **Okta** → Pega, started 09:14:22.
   > `[ View in Flow Visualizer ]`

3. **User clicks the button.** The app switches to the Flow Visualizer view, exactly
   like clicking a JWT header sends it to the Decoder today.

4. **Flow Visualizer opens pre-loaded**, showing the same step-by-step SVG walkthrough
   the tool already has — but now every value is real:
   - Step 1 — "Access Attempt": the actual `GET /prweb/...` request the customer's
     browser made.
   - Step 2 — "Redirect to IdP": the real `https://customer.okta.com/app/.../sso/saml`
     URL, not a placeholder.
   - Step 3 — "Authentication": marked as occurring at Okta (not captured in detail,
     since it's credential entry — shown as a pass-through step).
   - Step 4 — "SAML Response Generation": the real signed `SAMLResponse` payload, with
     a "Decode" affordance the same way JWTs get decoded elsewhere in the toolkit,
     showing the real `<saml:Issuer>`, `NameID`, and attributes pulled from the actual
     assertion.
   - Step 5 — "POST to SP (ACS)": the real POST to the Pega ACS URL.
   - Step 6 — "Session Established": Pega's real response, including the
     Pega session cookies (`Pega-UI-SessId`, etc.) that were set — with a note that
     the toolkit already highlights these as Pega-specific.

5. **Where it breaks down.** If the customer's issue was, say, an audience mismatch or
   an expired assertion, the engineer sees it directly in Step 4's decoded assertion
   instead of having to manually extract, base64-decode, and reformat the SAML
   response by hand — which is what they'd have to do today using DevTools + an
   external decoder.

6. **Any gaps are labeled, not hidden.** If the HAR happened to miss a leg (e.g. a
   background OIDC token refresh that a proxy dropped), that step shows as
   grayed-out with "Not captured in this HAR" instead of silently omitting it or
   showing fabricated data — important for a security/debugging tool where the user
   needs to trust that what's on screen is either real or clearly marked as inferred.

---

## Build Plan (chunked)

This is intentionally scoped to ship in independent, demo-able pieces:

| Chunk | Scope | Depends on |
|---|---|---|
| **1. Detector core** | `harFlowDetector.ts` — Pega-anchor detection + OAuth2/OIDC correlation via `state` only. No UI yet, just returns `DetectedFlow[]`, verifiable via console/tests against a real HAR. | Existing `har.ts` analysis |
| **2. OIDC wiring** | `FlowVisualizer` accepts `initialFlowData`; HAR Analyzer banner + navigation for OAuth2/OIDC flows only. | Chunk 1 |
| **3. SAML parsing** | `xmlService.parseSamlResponse()` (real decode, not mock generation); extend detector to classify + correlate SAML via `RelayState`/timestamp. | Chunk 1 |
| **4. SAML wiring** | Extend Chunk 2's UI path to also handle SAML flows end-to-end. | Chunk 3 |
| **5. Multi-flow handling** | Picker UI for HARs containing more than one detected flow. | Chunks 2 & 4 |
| **6. IdP fingerprint table** | Cosmetic hostname → brand/color matching (Okta, Microsoft, + whatever else comes up, Keyforge included if it has recognizable URL conventions). | Chunk 2 |
| **7. Device flow** *(lower priority — confirm this shows up in your HARs before building)* | Detector support for device-code polling patterns. | Chunk 1 |

Suggested starting point: **Chunk 1**, since everything downstream depends on having
a working, testable detector before any UI is touched.

---

## Open Questions

- Exact Pega ACS/callback URL pattern(s) to anchor on — best confirmed against a real
  captured HAR rather than assumed, since Pega deployments can customize auth service
  paths.
- Whether "Keyforge" has stable, recognizable URL conventions worth a dedicated
  fingerprint entry, or should just fall through to the generic "Unknown IdP" path.
- Redaction: should real tokens/assertions be shown as-is (matches today's "everything
  is local-only" model) or should there be an optional redact/mask toggle before
  display, given this pulls real production data into the visualizer instead of mock
  data?

---

*Document created as a design reference before implementation. No code changes have
been made to the project yet — this describes a phased plan to be built incrementally.*
