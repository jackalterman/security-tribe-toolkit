// harFlowDetector.ts
//
// HAR-to-Flow Reconstruction enhancement (see enhancement-har-flow-reconstruction.md).
//
// Pure, framework-free detection layer that walks a parsed HAR and
// reconstructs SSO login flows anchored on Pega as the fixed SP/client.
//
// Status:
//   - Chunk 1: Pega-anchor detection + OAuth2/OIDC correlation via `state`. Done.
//   - Chunk 3: SAML correlation via RelayState/timestamp, using
//     xmlService.parseSamlResponse() for real Issuer/NameID/Attribute
//     extraction. Done.
//   - detectFlows() is async because SAML decoding may require inflating a
//     DEFLATE-compressed redirect-binding payload (xmlService.decodeSamlInput
//     uses the async DecompressionStream API). Callers must await it.

import type { HarEntry, HarHeader, HarRoot } from './har';
import { jwtService } from './jwtService';
import { xmlService } from './xmlService';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FlowKind = 'oauth-oidc' | 'saml' | 'device';

export interface RealFlowStep {
  title: string;
  description: string;
  request?: {
    method: string;
    url: string;
    headers: HarHeader[];
    body?: string;
  };
  response?: {
    status: number;
    headers: HarHeader[];
    body?: string;
  };
  /** false = we know this step happened but didn't see it in the HAR (e.g. server-side token exchange) */
  captured: boolean;
}

export interface DetectedFlow {
  id: string;
  kind: FlowKind;
  confidence: 'high' | 'medium' | 'low';
  spHost: string; // always the Pega host in our use case
  idpHost: string; // observed IdP host
  idpDisplayName: string; // "Okta" / "Microsoft" / raw hostname if unrecognized
  issuer?: string; // from JWT `iss` or SAML <Issuer>
  steps: RealFlowStep[];
  sourceEntryIds: string[];
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Pega anchor detection
// ---------------------------------------------------------------------------

// Kept in sync with HarAnalyzer.tsx's PEGA_COOKIES list. Duplicated here
// (rather than imported) because HarAnalyzer.tsx doesn't currently export
// it — worth revisiting in Chunk 2 if we want a single shared source.
const PEGA_COOKIES = ['Pega-AAT', 'Pega-Perf', 'Pega-RULES', 'Pega-ThreadName', 'Pega-UI-SessId'];

// Common Pega auth-service path fragments. The exact ACS/callback path can
// vary by deployment (see Open Questions in the enhancement doc) so this is
// intentionally a loose fragment match rather than an exact route match.
const PEGA_URL_FRAGMENTS = ['/prweb/', 'prauth', 'prrestservice', 'prservlet'];

function getCookieHeaderValue(headers: HarHeader[]): string {
  return headers.find(h => h.name.toLowerCase() === 'cookie')?.value || '';
}

function hasPegaCookie(entry: HarEntry): boolean {
  const cookieNames = [
    ...entry.request.cookies.map(c => c.name),
    ...entry.response.cookies.map(c => c.name),
  ];
  if (cookieNames.some(name => PEGA_COOKIES.some(p => name.toLowerCase().includes(p.toLowerCase())))) {
    return true;
  }
  // Some HAR captures only populate the raw Cookie header, not the
  // structured cookies array — check that too.
  const rawCookieHeader = getCookieHeaderValue(entry.request.headers).toLowerCase();
  return PEGA_COOKIES.some(p => rawCookieHeader.includes(p.toLowerCase()));
}

function hasPegaUrlFragment(url: string): boolean {
  const lower = url.toLowerCase();
  return PEGA_URL_FRAGMENTS.some(frag => lower.includes(frag));
}

function isPegaEntry(entry: HarEntry): boolean {
  return hasPegaCookie(entry) || hasPegaUrlFragment(entry.request.url);
}

function getHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Finds the Pega host for this HAR by scanning for the first entry that
 * looks like Pega (cookie or URL match). Returns null if no Pega entries
 * are found, since without an SP anchor there's nothing to correlate a
 * flow against for this toolkit's use case.
 */
function findPegaHost(entries: HarEntry[]): string | null {
  const pegaEntry = entries.find(isPegaEntry);
  return pegaEntry ? getHost(pegaEntry.request.url) : null;
}

// ---------------------------------------------------------------------------
// OAuth2 / OIDC detection + correlation
// ---------------------------------------------------------------------------

function getQueryParam(url: string, param: string): string | null {
  try {
    return new URL(url).searchParams.get(param);
  } catch {
    return null;
  }
}

interface OAuthCandidate {
  authorizeEntry: HarEntry; // redirect to IdP /authorize (or similar)
  callbackEntry: HarEntry; // return to Pega with code= & state=
  state: string;
}

/**
 * Finds /authorize -> callback pairs correlated by `state`, where the
 * callback lands back on the Pega host. This is a simple two-anchor
 * correlation: it does not (yet) attempt to locate the server-side
 * POST /token exchange, since that call is typically absent from a
 * browser-captured HAR (see enhancement doc, algorithm step 5).
 */
function findOAuthCandidates(entries: HarEntry[], pegaHost: string): OAuthCandidate[] {
  const candidates: OAuthCandidate[] = [];

  // Callback entries: land on Pega, carry both code= and state= — this
  // mirrors the existing authType === 'OAuth2' heuristic in har.ts.
  const callbacks = entries.filter(e => {
    const host = getHost(e.request.url);
    return (
      host === pegaHost &&
      getQueryParam(e.request.url, 'code') &&
      getQueryParam(e.request.url, 'state')
    );
  });

  for (const callbackEntry of callbacks) {
    const state = getQueryParam(callbackEntry.request.url, 'state');
    if (!state) continue;

    // Find the earlier redirect to a *different* host that carries the
    // same state and looks like an authorize request (response_type,
    // client_id, or a /authorize-ish path are all reasonable signals;
    // we accept any of them to stay resilient to different IdPs).
    const authorizeEntry = entries.find(e => {
      if (e === callbackEntry) return false;
      if (new Date(e.startedDateTime) > new Date(callbackEntry.startedDateTime)) return false;
      const host = getHost(e.request.url);
      if (host === pegaHost) return false;
      const stateMatches = getQueryParam(e.request.url, 'state') === state;
      if (!stateMatches) return false;
      return true;
    });

    if (authorizeEntry) {
      candidates.push({ authorizeEntry, callbackEntry, state });
    }
  }

  return candidates;
}

// Cosmetic-only fingerprint table (Chunk 6 will expand this). No match
// falls through to showing the raw hostname, per the enhancement doc —
// branding is decoration, not a dependency for correctness.
const IDP_FINGERPRINTS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\.okta\.com$/i, name: 'Okta' },
  { pattern: /\.oktapreview\.com$/i, name: 'Okta' },
  { pattern: /login\.microsoftonline\.com$/i, name: 'Microsoft Entra' },
  { pattern: /\.microsoftonline\.com$/i, name: 'Microsoft Entra' },
];

function getIdpDisplayName(host: string): string {
  const match = IDP_FINGERPRINTS.find(f => f.pattern.test(host));
  return match ? match.name : host;
}

function buildFlowStep(
  title: string,
  description: string,
  entry: HarEntry | null,
  captured: boolean
): RealFlowStep {
  if (!entry) {
    return { title, description, captured };
  }
  return {
    title,
    description,
    request: {
      method: entry.request.method,
      url: entry.request.url,
      headers: entry.request.headers,
      body: entry.request.postData?.text,
    },
    response: {
      status: entry.response.status,
      headers: entry.response.headers,
      body: entry.response.content.text,
    },
    captured,
  };
}

function buildOAuthFlow(candidate: OAuthCandidate, pegaHost: string): DetectedFlow {
  const { authorizeEntry, callbackEntry, state } = candidate;
  const idpHost = getHost(authorizeEntry.request.url);

  // Try to recover the issuer from any JWT visible in the callback leg
  // (e.g. an id_token sometimes appears in a fragment-turned-query on
  // implicit/hybrid flows, or in a subsequent request). This is best
  // effort — most of the time the id_token isn't visible until the
  // (uncaptured) token exchange, which is why this is optional.
  let issuer: string | undefined;
  const idTokenParam = getQueryParam(callbackEntry.request.url, 'id_token');
  if (idTokenParam) {
    const decoded = jwtService.decode(idTokenParam);
    issuer = decoded?.payload.iss;
  }

  const steps: RealFlowStep[] = [
    buildFlowStep(
      'Redirect to IdP',
      `Pega redirected the browser to ${idpHost} to begin authentication.`,
      authorizeEntry,
      true
    ),
    buildFlowStep(
      'Authentication at IdP',
      `The user authenticated at ${idpHost}. Credential entry is not visible in the HAR.`,
      null,
      false
    ),
    buildFlowStep(
      'Callback to Pega (SP)',
      `The IdP redirected back to Pega with an authorization code (state matched: ${state}).`,
      callbackEntry,
      true
    ),
    buildFlowStep(
      'Token Exchange',
      'Pega exchanged the authorization code for tokens via a server-to-server call. Not visible in a browser-captured HAR.',
      null,
      false
    ),
  ];

  return {
    id: `oauth-${callbackEntry._id || callbackEntry.startedDateTime}`,
    kind: 'oauth-oidc',
    confidence: 'high',
    spHost: pegaHost,
    idpHost,
    idpDisplayName: getIdpDisplayName(idpHost),
    issuer,
    steps,
    sourceEntryIds: [authorizeEntry._id, callbackEntry._id].filter(Boolean) as string[],
    startedAt: authorizeEntry.startedDateTime,
  };
}

// ---------------------------------------------------------------------------
// SAML detection + correlation
// ---------------------------------------------------------------------------

function isSamlEntry(entry: HarEntry): boolean {
  return (
    entry.request.url.includes('SAMLRequest') ||
    entry.request.url.includes('SAMLResponse') ||
    !!entry.request.postData?.text?.includes('SAMLRequest') ||
    !!entry.request.postData?.text?.includes('SAMLResponse')
  );
}

/** Reads a SAML query/form param from either the URL (Redirect binding) or POST body (POST binding). */
function getSamlParamFromEntry(entry: HarEntry, param: 'SAMLRequest' | 'SAMLResponse' | 'RelayState'): string | null {
  const fromQuery = getQueryParam(entry.request.url, param);
  if (fromQuery) return fromQuery;
  const text = entry.request.postData?.text;
  if (text) {
    try {
      return new URLSearchParams(text).get(param);
    } catch {
      return null;
    }
  }
  return null;
}

/** Best-effort hostname for a SAML entity ID. Many IdP issuers are plain URLs, but the
 * SAML spec allows any URI (including URNs), so this falls back to the raw string. */
function safeHostFromIssuer(issuer: string): string {
  try {
    return new URL(issuer).host || issuer;
  } catch {
    return issuer;
  }
}

interface SamlCandidate {
  requestEntry: HarEntry | null; // the SP -> IdP redirect carrying SAMLRequest (may be absent from the HAR)
  responseEntry: HarEntry; // the POST back to Pega's ACS carrying SAMLResponse
  relayState: string | null;
}

/**
 * Finds SAMLResponse deliveries to the Pega ACS and, where possible, the
 * matching SAMLRequest that started that login. Correlated first via
 * RelayState (the SAML equivalent of OAuth's `state`); if RelayState is
 * absent or doesn't match anything, falls back to the nearest preceding
 * SAMLRequest entry by timestamp, per the enhancement doc's algorithm.
 */
function findSamlCandidates(entries: HarEntry[], pegaHost: string): SamlCandidate[] {
  const responseEntries = entries.filter(
    e => getHost(e.request.url) === pegaHost && !!getSamlParamFromEntry(e, 'SAMLResponse')
  );
  const requestEntries = entries.filter(
    e => getHost(e.request.url) !== pegaHost && !!getSamlParamFromEntry(e, 'SAMLRequest')
  );

  return responseEntries.map(responseEntry => {
    const relayState = getSamlParamFromEntry(responseEntry, 'RelayState');

    let requestEntry: HarEntry | null = null;
    if (relayState) {
      requestEntry = requestEntries.find(e => getSamlParamFromEntry(e, 'RelayState') === relayState) || null;
    }
    if (!requestEntry) {
      const priorRequests = requestEntries.filter(
        e => new Date(e.startedDateTime).getTime() <= new Date(responseEntry.startedDateTime).getTime()
      );
      requestEntry =
        priorRequests.length > 0
          ? priorRequests.reduce((latest, e) =>
              new Date(e.startedDateTime).getTime() > new Date(latest.startedDateTime).getTime() ? e : latest
            )
          : null;
    }

    return { requestEntry, responseEntry, relayState };
  });
}

async function buildSamlFlow(candidate: SamlCandidate, pegaHost: string): Promise<DetectedFlow> {
  const { requestEntry, responseEntry, relayState } = candidate;

  const samlResponseRaw = getSamlParamFromEntry(responseEntry, 'SAMLResponse');
  const parsedResponse = samlResponseRaw ? await xmlService.parseSamlResponse(samlResponseRaw) : null;

  let requestIssuer: string | undefined;
  if (requestEntry) {
    const samlRequestRaw = getSamlParamFromEntry(requestEntry, 'SAMLRequest');
    if (samlRequestRaw) {
      try {
        const parsedRequest = await xmlService.parseSamlResponse(samlRequestRaw);
        requestIssuer = parsedRequest.issuer;
      } catch {
        // Request parsing is best-effort context only — the response is what matters.
      }
    }
  }

  const idpHost = requestEntry
    ? getHost(requestEntry.request.url)
    : parsedResponse?.issuer
    ? safeHostFromIssuer(parsedResponse.issuer)
    : 'unknown-idp';

  const statusLabel = parsedResponse?.statusCode?.split(':').pop();

  const steps: RealFlowStep[] = [
    buildFlowStep(
      'Redirect to IdP',
      requestEntry
        ? `Pega redirected the browser to ${idpHost} with a SAMLRequest${relayState ? ` (RelayState matched: ${relayState})` : ' (correlated by timestamp)'}.`
        : `The initial redirect to ${idpHost} was not captured in this HAR.`,
      requestEntry,
      !!requestEntry
    ),
    buildFlowStep(
      'Authentication at IdP',
      `The user authenticated at ${idpHost}. Credential entry is not visible in the HAR.`,
      null,
      false
    ),
    buildFlowStep(
      'POST to SP (ACS)',
      parsedResponse
        ? `The browser POSTed a signed SAMLResponse to Pega's Assertion Consumer Service${statusLabel ? ` (status: ${statusLabel})` : ''}${parsedResponse.nameId ? `, asserting NameID "${parsedResponse.nameId}"` : ''}.`
        : "The browser POSTed a SAMLResponse to Pega's Assertion Consumer Service, but it could not be decoded/parsed.",
      responseEntry,
      true
    ),
  ];

  return {
    id: `saml-${responseEntry._id || responseEntry.startedDateTime}`,
    kind: 'saml',
    confidence: requestEntry ? 'high' : 'medium',
    spHost: pegaHost,
    idpHost,
    idpDisplayName: getIdpDisplayName(idpHost),
    issuer: parsedResponse?.issuer || requestIssuer,
    steps,
    sourceEntryIds: [requestEntry?._id, responseEntry._id].filter(Boolean) as string[],
    startedAt: (requestEntry || responseEntry).startedDateTime,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Detects reconstructable SSO flows in a parsed HAR.
 *
 * Chunk 1 scope: OAuth2/OIDC flows are fully reconstructed. SAML entries
 * are recognized (so the caller can show a "SAML detected, full
 * reconstruction coming soon" affordance if desired) but are not yet
 * returned as DetectedFlow objects — that lands in Chunk 3/4 once
 * xmlService.parseSamlResponse() exists.
 */
export function detectFlows(har: HarRoot): DetectedFlow[] {
  const entries = har.log?.entries || [];
  if (entries.length === 0) return [];

  const pegaHost = findPegaHost(entries);
  if (!pegaHost) return [];

  const flows: DetectedFlow[] = [];

  const oauthCandidates = findOAuthCandidates(entries, pegaHost);
  for (const candidate of oauthCandidates) {
    flows.push(buildOAuthFlow(candidate, pegaHost));
  }

  // Sort chronologically so a HAR with multiple flows (e.g. login + later
  // re-auth) presents in the order they occurred.
  flows.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  return flows;
}

/**
 * Convenience helper for Chunk 2's UI: true if the HAR contains SAML
 * traffic that detectFlows() can't fully reconstruct yet in this chunk.
 */
export function hasUnreconstructedSamlTraffic(har: HarRoot): boolean {
  const entries = har.log?.entries || [];
  return entries.some(isSamlEntry);
}
