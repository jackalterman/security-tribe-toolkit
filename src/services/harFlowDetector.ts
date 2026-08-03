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
//   - Real-HAR validation pass: flows now reconstruct the FULL real
//     transcript (every entry between the auth-service launch and the
//     session being established), not just a fixed 3-4 step summary.
//     See findFlowStartEntry / findSessionEstablishedEntry / buildStepTimeline.
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

/** Which of the 3 diagram nodes a step's request effectively touches. Every
 * captured entry is fundamentally a browser request, so it's always framed
 * as `user -> client` (hit Pega) or `user -> auth` (hit the IdP). The one
 * exception is the synthetic, never-captured backend token exchange, which
 * is the sole `client -> auth` edge we ever show. */
export type FlowNode = 'user' | 'client' | 'auth';

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
  nodeFrom: FlowNode;
  nodeTo: FlowNode;
}

/** A single HAR entry that contributed to a reconstructed flow, enriched with
 * enough context (its position in the original capture, method/url/status)
 * for the UI to show something more useful than a bare opaque id. */
export interface SourceHarRequestRef {
  id: string;
  /** 1-based position of this request within the FULL original HAR capture
   * (har.log.entries), so the UI can show e.g. "Request #47 of 312" and the
   * count always matches what's actually in the uploaded file. */
  index: number;
  method: string;
  url: string;
  status: number;
  startedAt: string;
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
  sourceEntries: SourceHarRequestRef[];
  /** Total number of requests in the full uploaded HAR (not just this flow's window) — for "N of TOTAL" display. */
  totalHarEntries: number;
  startedAt: string;
}

// ---------------------------------------------------------------------------
// Pega anchor detection
// ---------------------------------------------------------------------------

// Kept in sync with HarAnalyzer.tsx's PEGA_COOKIES list. Duplicated here
// (rather than imported) because HarAnalyzer.tsx doesn't currently export
// it — worth revisiting if we want a single shared source.
const PEGA_COOKIES = ['Pega-AAT', 'Pega-Perf', 'Pega-RULES', 'Pega-ThreadName', 'Pega-UI-SessId'];

// Common Pega auth-service path fragments. Confirmed against real captures:
// OAuth callbacks land on /PRAuth, SAML ACS is /PRRestService/WebSSO/SAML/v2/...
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

function getPathname(url: string): string {
  try {
    return new URL(url).pathname;
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

/**
 * True if a request carries a Pega-AAT cookie — the marker that the
 * authenticated app session has been established. Checked on the REQUEST
 * (not response Set-Cookie), since we want the first hit where the browser
 * is presenting an already-issued AAT, confirmed against real captures.
 */
function hasPegaAatRequestCookie(entry: HarEntry): boolean {
  if (entry.request.cookies.some(c => c.name.toLowerCase().includes('pega-aat'))) return true;
  return getCookieHeaderValue(entry.request.headers).toLowerCase().includes('pega-aat');
}

function isStandardThreadPath(pathname: string): boolean {
  return /!standard/i.test(pathname) || /%21standard/i.test(pathname);
}

/**
 * Finds the entry that actually kicks off this login: the hit to Pega's
 * PRAuth servlet that names the auth service, e.g.
 * /PRAuth/app/<appName>/Auth0_OIDC/ or /PRAuth/app/default/<AuthService>/.
 * Identified by: last path segment isn't a thread ID (doesn't end in '*',
 * per real Pega thread-ID shape) and isn't a !STANDARD hit. Picks the
 * closest such entry before `beforeEntry` so multiple flows/re-auths within
 * one HAR each get their own correct launch entry.
 */
function findFlowStartEntry(entries: HarEntry[], pegaHost: string, beforeEntry: HarEntry): HarEntry | null {
  const beforeTime = new Date(beforeEntry.startedDateTime).getTime();
  const candidates = entries.filter(e => {
    if (getHost(e.request.url) !== pegaHost) return false;
    if (new Date(e.startedDateTime).getTime() > beforeTime) return false;
    const pathname = getPathname(e.request.url);
    if (!/\/prauth\//i.test(pathname)) return false;
    if (isStandardThreadPath(pathname)) return false;
    const segments = pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] || '';
    if (last.endsWith('*')) return false; // thread-ID segment, not an auth service name
    return true;
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, e) =>
    new Date(e.startedDateTime).getTime() > new Date(latest.startedDateTime).getTime() ? e : latest
  );
}

/**
 * Finds the first !STANDARD hit (after `afterEntry`) that carries a
 * Pega-AAT cookie on the request — i.e. the moment the authenticated app
 * session is confirmed established, per real-capture validation.
 */
function findSessionEstablishedEntry(entries: HarEntry[], pegaHost: string, afterEntry: HarEntry): HarEntry | null {
  const afterTime = new Date(afterEntry.startedDateTime).getTime();
  const candidates = entries.filter(e => {
    if (getHost(e.request.url) !== pegaHost) return false;
    if (new Date(e.startedDateTime).getTime() < afterTime) return false;
    if (!isStandardThreadPath(getPathname(e.request.url))) return false;
    return hasPegaAatRequestCookie(e);
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((earliest, e) =>
    new Date(e.startedDateTime).getTime() < new Date(earliest.startedDateTime).getTime() ? e : earliest
  );
}

// ---------------------------------------------------------------------------
// Step timeline construction (shared by OAuth and SAML)
// ---------------------------------------------------------------------------

function extractLastPathSegment(url: string): string {
  const segments = getPathname(url).split('/').filter(Boolean);
  return segments[segments.length - 1] || '';
}

function humanizeIdpSegment(url: string): string {
  const pathname = getPathname(url).toLowerCase();
  if (pathname.includes('/samlp/')) return 'SAML Request';
  const last = extractLastPathSegment(url).toLowerCase();
  if (last === 'resume') return 'Resume';
  if (last === 'login') return 'Login';
  if (last === 'authorize') return 'Authorize';
  return last ? last.charAt(0).toUpperCase() + last.slice(1) : 'Request';
}

/** Builds a SourceHarRequestRef for `entry`, resolving its 1-based position
 * within `allEntries` (the full original capture) so the UI can display a
 * request's real place in the uploaded HAR, not just an opaque id. */
function toSourceRef(entry: HarEntry, allEntries: HarEntry[]): SourceHarRequestRef {
  return {
    id: entry._id || '',
    index: allEntries.indexOf(entry) + 1,
    method: entry.request.method,
    url: entry.request.url,
    status: entry.response.status,
    startedAt: entry.startedDateTime,
  };
}

function buildFlowStep(
  title: string,
  description: string,
  entry: HarEntry | null,
  captured: boolean,
  nodeFrom: FlowNode,
  nodeTo: FlowNode
): RealFlowStep {
  if (!entry) {
    return { title, description, captured, nodeFrom, nodeTo };
  }
  return {
    title,
    description,
    captured,
    nodeFrom,
    nodeTo,
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
  };
}

function describeStep(
  entry: HarEntry,
  ctx: { pegaHost: string; isFirst: boolean; isLast: boolean; isCallback: boolean; flowKind: FlowKind }
): { title: string; description: string } {
  const host = getHost(entry.request.url);
  const onPega = host === ctx.pegaHost;
  const kindLabel = ctx.flowKind === 'saml' ? 'SAML' : 'OIDC/OAuth2';

  // isCallback is checked first: in the rare case where a flow's start and
  // end both collapse onto the same anchor entry (e.g. a SAML flow whose
  // initial redirect wasn't captured, so the ACS POST is the only entry in
  // range), "Return to Pega (SP)" is the most accurate label for it.
  if (ctx.isCallback) {
    return {
      title: 'Return to Pega (SP)',
      description: `The IdP delivered the ${ctx.flowKind === 'saml' ? 'SAMLResponse' : 'authorization code'} back to Pega.`,
    };
  }
  if (ctx.isFirst) {
    const authServiceName = extractLastPathSegment(entry.request.url) || 'the configured auth service';
    return {
      title: 'Auth Service Launch',
      description: `Pega launched the "${authServiceName}" auth service, beginning ${kindLabel} authentication.`,
    };
  }
  if (ctx.isLast) {
    return {
      title: 'Session Established',
      description: 'This request carried the Pega-AAT session cookie — sign-in completed and the authenticated app loaded.',
    };
  }
  if (!onPega) {
    return {
      title: `IdP: ${humanizeIdpSegment(entry.request.url)}`,
      description: `${entry.request.method} request to ${host}.`,
    };
  }
  return {
    title: 'Pega Internal Redirect',
    description: `Pega processed an internal redirect/session hop (${entry.request.method} \u2192 HTTP ${entry.response.status}).`,
  };
}

interface StepTimelineContext {
  pegaHost: string;
  idpHost: string;
  flowKind: FlowKind;
  flowStartEntry: HarEntry | null;
  terminalEntry: HarEntry | null;
  callbackEntry: HarEntry; // the "code/SAMLResponse delivered to Pega" anchor
  fallbackStartEntry: HarEntry; // used when flowStartEntry couldn't be found
}

/**
 * Builds the full step-by-step timeline: every entry between the flow's
 * start and the session being established (inclusive), restricted to the
 * Pega and IdP hosts so unrelated third-party noise (analytics, CDN, etc.)
 * captured in the same window doesn't get pulled in as if it were part of
 * the login. Falls back gracefully to just the callback/response anchor
 * when the launch or session-established entries can't be located (e.g. a
 * trimmed HAR that doesn't include them).
 */
function buildStepTimeline(entries: HarEntry[], ctx: StepTimelineContext): { steps: RealFlowStep[]; sourceEntries: SourceHarRequestRef[] } {
  const rangeStart = ctx.flowStartEntry || ctx.fallbackStartEntry;
  const rangeEnd = ctx.terminalEntry || ctx.callbackEntry;

  const startTime = new Date(rangeStart.startedDateTime).getTime();
  const endTime = new Date(rangeEnd.startedDateTime).getTime();
  const relevantHosts = new Set([ctx.pegaHost, ctx.idpHost]);

  const windowEntries = entries
    .filter(e => {
      const t = new Date(e.startedDateTime).getTime();
      if (t < startTime || t > endTime) return false;
      return relevantHosts.has(getHost(e.request.url));
    })
    .sort((a, b) => new Date(a.startedDateTime).getTime() - new Date(b.startedDateTime).getTime());

  const steps: RealFlowStep[] = windowEntries.map(entry => {
    const isFirst = entry === rangeStart;
    const isLast = entry === rangeEnd;
    const isCallback = entry === ctx.callbackEntry;
    const { title, description } = describeStep(entry, {
      pegaHost: ctx.pegaHost,
      isFirst,
      isLast,
      isCallback,
      flowKind: ctx.flowKind,
    });
    const onPega = getHost(entry.request.url) === ctx.pegaHost;
    return buildFlowStep(title, description, entry, true, 'user', onPega ? 'client' : 'auth');
  });

  if (ctx.flowKind === 'oauth-oidc') {
    steps.push(
      buildFlowStep(
        'Token Exchange',
        'Pega exchanged the authorization code for tokens via a server-to-server call. Not visible in a browser-captured HAR.',
        null,
        false,
        'client',
        'auth'
      )
    );
  }

  const sourceEntries: SourceHarRequestRef[] = windowEntries
    .filter(e => !!e._id)
    .map(e => toSourceRef(e, entries));
  return { steps, sourceEntries };
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

  // Pega's PRAuth servlet commonly 307/303-redirects the browser through
  // several internal URL-normalization hops after the code comes back
  // (e.g. /PRAuth -> /PRAuth/app/<name>/ -> .../<thread>*/!STANDARD),
  // and it re-appends the *same* code/state to every hop's URL. Only the
  // first hit is the real "code arrived at the SP" event — grouping by
  // state and keeping the earliest avoids emitting one duplicate
  // DetectedFlow per redirect hop for what is actually a single login.
  const earliestCallbackByState = new Map<string, HarEntry>();
  for (const entry of callbacks) {
    const state = getQueryParam(entry.request.url, 'state');
    if (!state) continue;
    const existing = earliestCallbackByState.get(state);
    if (!existing || new Date(entry.startedDateTime).getTime() < new Date(existing.startedDateTime).getTime()) {
      earliestCallbackByState.set(state, entry);
    }
  }

  for (const callbackEntry of earliestCallbackByState.values()) {
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

// Cosmetic-only fingerprint table. No match falls through to showing the
// raw hostname, per the enhancement doc — branding is decoration, not a
// dependency for correctness.
const IDP_FINGERPRINTS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\.okta\.com$/i, name: 'Okta' },
  { pattern: /\.oktapreview\.com$/i, name: 'Okta' },
  { pattern: /login\.microsoftonline\.com$/i, name: 'Microsoft Entra' },
  { pattern: /\.microsoftonline\.com$/i, name: 'Microsoft Entra' },
  { pattern: /\.auth0\.com$/i, name: 'Auth0' },
];

function getIdpDisplayName(host: string): string {
  const match = IDP_FINGERPRINTS.find(f => f.pattern.test(host));
  return match ? match.name : host;
}

function buildOAuthFlow(candidate: OAuthCandidate, pegaHost: string, allEntries: HarEntry[]): DetectedFlow {
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

  const flowStartEntry = findFlowStartEntry(allEntries, pegaHost, authorizeEntry);
  const terminalEntry = findSessionEstablishedEntry(allEntries, pegaHost, callbackEntry);

  const { steps, sourceEntries } = buildStepTimeline(allEntries, {
    pegaHost,
    idpHost,
    flowKind: 'oauth-oidc',
    flowStartEntry,
    terminalEntry,
    callbackEntry,
    fallbackStartEntry: authorizeEntry,
  });

  return {
    id: `oauth-${callbackEntry._id || callbackEntry.startedDateTime}`,
    kind: 'oauth-oidc',
    confidence: terminalEntry ? 'high' : 'medium',
    spHost: pegaHost,
    idpHost,
    idpDisplayName: getIdpDisplayName(idpHost),
    issuer,
    steps,
    sourceEntries: sourceEntries.length > 0
      ? sourceEntries
      : [authorizeEntry, callbackEntry].filter(e => !!e._id).map(e => toSourceRef(e, allEntries)),
    totalHarEntries: allEntries.length,
    startedAt: (flowStartEntry || authorizeEntry).startedDateTime,
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

async function buildSamlFlow(candidate: SamlCandidate, pegaHost: string, allEntries: HarEntry[]): Promise<DetectedFlow> {
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

  const flowStartEntry = requestEntry ? findFlowStartEntry(allEntries, pegaHost, requestEntry) : null;
  const terminalEntry = findSessionEstablishedEntry(allEntries, pegaHost, responseEntry);

  const { steps, sourceEntries } = buildStepTimeline(allEntries, {
    pegaHost,
    idpHost,
    flowKind: 'saml',
    flowStartEntry,
    terminalEntry,
    callbackEntry: responseEntry,
    fallbackStartEntry: requestEntry || responseEntry,
  });

  // If the initial redirect to the IdP wasn't captured, prepend two
  // synthetic (uncaptured) steps for continuity, same as the OAuth flow's
  // uncaptured "Token Exchange" step — flagging that these things happened
  // even though the HAR doesn't show them.
  if (!requestEntry) {
    steps.unshift(
      buildFlowStep(
        'Redirect to IdP',
        `The initial redirect to ${idpHost} was not captured in this HAR.`,
        null,
        false,
        'client',
        'auth'
      ),
      buildFlowStep(
        'Authentication at IdP',
        `The user authenticated at ${idpHost}. Credential entry is not visible in the HAR.`,
        null,
        false,
        'user',
        'auth'
      )
    );
  }

  const statusLabel = parsedResponse?.statusCode?.split(':').pop();
  // Enrich the "Return to Pega (SP)" step's description with parsed SAML
  // details now that we have them (buildStepTimeline doesn't have access
  // to the parsed assertion, only the raw entry).
  const callbackStep = steps.find(s => s.title === 'Return to Pega (SP)');
  if (callbackStep && parsedResponse) {
    callbackStep.description = `The IdP delivered a signed SAMLResponse to Pega's ACS${statusLabel ? ` (status: ${statusLabel})` : ''}${relayState ? ` (RelayState matched: ${relayState})` : ''}${parsedResponse.nameId ? `, asserting NameID "${parsedResponse.nameId}"` : ''}.`;
  } else if (callbackStep && !parsedResponse) {
    callbackStep.description = "The IdP delivered a SAMLResponse to Pega's ACS, but it could not be decoded/parsed.";
  }

  return {
    id: `saml-${responseEntry._id || responseEntry.startedDateTime}`,
    kind: 'saml',
    confidence: requestEntry && terminalEntry ? 'high' : 'medium',
    spHost: pegaHost,
    idpHost,
    idpDisplayName: getIdpDisplayName(idpHost),
    issuer: parsedResponse?.issuer || requestIssuer,
    steps,
    sourceEntries: sourceEntries.length > 0
      ? sourceEntries
      : [requestEntry, responseEntry].filter((e): e is HarEntry => !!e && !!e._id).map(e => toSourceRef(e, allEntries)),
    totalHarEntries: allEntries.length,
    startedAt: (flowStartEntry || requestEntry || responseEntry).startedDateTime,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Detects reconstructable SSO flows in a parsed HAR.
 *
 * OAuth2/OIDC flows are correlated via `state`. SAML flows are correlated
 * via RelayState (falling back to nearest-preceding-request by timestamp)
 * and fully parsed for Issuer/NameID/status via xmlService.parseSamlResponse().
 * Each flow's steps span the full real transcript: from the Pega auth-service
 * launch entry through every redirect/IdP call to the first request that
 * carries the Pega-AAT session cookie.
 *
 * Async: SAML's Redirect-binding payloads may be DEFLATE-compressed, which
 * requires the async DecompressionStream API to decode. Callers must await.
 */
export async function detectFlows(har: HarRoot): Promise<DetectedFlow[]> {
  const entries = har.log?.entries || [];
  if (entries.length === 0) return [];

  const pegaHost = findPegaHost(entries);
  if (!pegaHost) return [];

  const flows: DetectedFlow[] = [];

  const oauthCandidates = findOAuthCandidates(entries, pegaHost);
  for (const candidate of oauthCandidates) {
    flows.push(buildOAuthFlow(candidate, pegaHost, entries));
  }

  const samlCandidates = findSamlCandidates(entries, pegaHost);
  for (const candidate of samlCandidates) {
    try {
      flows.push(await buildSamlFlow(candidate, pegaHost, entries));
    } catch {
      // Skip SAML payloads that fail to decode/parse entirely (e.g. a
      // corrupted capture) rather than surfacing a broken flow card.
      // hasUnreconstructedSamlTraffic() still flags that SAML was present.
    }
  }

  // Sort chronologically so a HAR with multiple flows (e.g. login + later
  // re-auth) presents in the order they occurred.
  flows.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  return flows;
}

/**
 * True if the HAR contains SAML-shaped traffic at all (SAMLRequest/
 * SAMLResponse params seen anywhere). Used by the UI to show a note when
 * SAML entries exist but didn't produce a matching DetectedFlow — e.g. a
 * SAMLResponse landed outside the Pega host, or a payload failed to parse.
 */
export function hasUnreconstructedSamlTraffic(har: HarRoot): boolean {
  const entries = har.log?.entries || [];
  return entries.some(isSamlEntry);
}
