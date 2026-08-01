import React, { useState } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import Tabs from './Tabs';
import CodeBlock from './CodeBlock';
import { xmlService } from '../services/xmlService';
import { storageService } from '../services/storageService';
import { FileCodeIcon, SendIcon, ShieldCheckIcon, SearchIcon, ClipboardIcon, TrashIcon, RefreshIcon, CheckIcon, BookIcon } from './icons';

type SamlView = 'Inspector' | 'Response Gen' | 'Request Gen' | 'Metadata' | 'Sig Analyzer';

type SamlSummary = {
    issuer?: string;
    subject?: string;
    audience?: string;
    destination?: string;
    notBefore?: string;
    notOnOrAfter?: string;
    attributes?: { name: string; value: string }[];
    error?: string;
};

const SamlTools: React.FC = () => {
    const [activeView, setActiveView] = usePersistentState<SamlView>('saml-active-view', 'Inspector');
    const [inspectorInput, setInspectorInput] = usePersistentState('saml-inspector-input', '');
    const [sigAnalyzerInput, setSigAnalyzerInput] = usePersistentState('saml-sig-input', '');
    const [prettyXml, setPrettyXml] = usePersistentState('saml-pretty-xml', '');
    const [sigAnalysis, setSigAnalysis] = useState<any>(null);
    const [samlSummary, setSamlSummary] = useState<SamlSummary | null>(null);
    const [copySuccess, setCopySuccess] = useState(false);
    const [detectedEncoding, setDetectedEncoding] = useState<string | null>(null);
    const [copiedAttrIndex, setCopiedAttrIndex] = useState<number | null>(null);

    const copyAttrValue = (value: string, index: number) => {
        navigator.clipboard.writeText(value);
        setCopiedAttrIndex(index);
        setTimeout(() => setCopiedAttrIndex(null), 1500);
    };

    const parseSamlSummary = (xml: string): SamlSummary => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xml, 'application/xml');
        if (doc.querySelector('parsererror')) {
            return { error: 'Invalid XML input' };
        }

        const samlNS = 'urn:oasis:names:tc:SAML:2.0:assertion';
        const getText = (namespace: string, localName: string) => doc.getElementsByTagNameNS(namespace, localName)[0]?.textContent?.trim();
        const getElements = (namespace: string, localName: string): Element[] => {
            const nsEls = Array.from(doc.getElementsByTagNameNS(namespace, localName));
            if (nsEls.length > 0) return nsEls;
            return Array.from(doc.getElementsByTagNameNS('', localName));
        };

        const issuer = getText(samlNS, 'Issuer') || getText('', 'Issuer');
        const subject = getText(samlNS, 'NameID') || getText('', 'NameID');
        const audience = getText(samlNS, 'Audience') || getText('', 'Audience');

        const responseElement = doc.documentElement;
        const destination = responseElement?.getAttribute('Destination') || undefined;

        const conditions = doc.getElementsByTagNameNS(samlNS, 'Conditions')[0];
        const notBefore = conditions?.getAttribute('NotBefore') || undefined;
        const notOnOrAfter = conditions?.getAttribute('NotOnOrAfter') || undefined;

        const attributes = getElements(samlNS, 'Attribute').map((attrEl) => {
            const name = attrEl.getAttribute('FriendlyName') || attrEl.getAttribute('Name') || '(unnamed)';
            const valueEls = getElements(samlNS, 'AttributeValue').filter((v) => v.parentElement === attrEl);
            const values = valueEls.map((v) => v.textContent?.trim() || '').filter(Boolean);
            return { name, value: values.join(', ') };
        });

        return {
            issuer,
            subject,
            audience,
            destination,
            notBefore,
            notOnOrAfter,
            attributes
        };
    };

    // Response State
    const [issuer, setIssuer] = usePersistentState('saml-resp-issuer', 'https://idp.example.com');
    const [subject, setSubject] = usePersistentState('saml-resp-subject', 'user@example.com');
    const [audience, setAudience] = usePersistentState('saml-resp-audience', 'https://sp.example.com');
    const [acsUrl, setAcsUrl] = usePersistentState('saml-resp-acs', 'https://sp.example.com/acs');
    const [attrName, setAttrName] = usePersistentState('saml-resp-attr-name', 'role');
    const [attrVal, setAttrVal] = usePersistentState('saml-resp-attr-val', 'admin');

    // Request State
    const [reqIssuer, setReqIssuer] = usePersistentState('saml-req-issuer', 'https://sp.example.com');
    const [reqAcsUrl, setReqAcsUrl] = usePersistentState('saml-req-acs', 'https://sp.example.com/acs');
    const [reqDestination, setReqDestination] = usePersistentState('saml-req-dest', 'https://idp.example.com/sso');

    // Metadata State
    const [metaEntityId, setMetaEntityId] = usePersistentState('saml-meta-entity', 'https://sp.example.com');
    const [metaType, setMetaType] = usePersistentState<'sp' | 'idp'>('saml-meta-type', 'sp');

    const handleInspect = async () => {
        try {
            const { xml, detected } = await xmlService.decodeSamlInput(inspectorInput);
            setDetectedEncoding(detected);
            setPrettyXml(xmlService.formatXml(xml));
            const summary = parseSamlSummary(xml);
            setSamlSummary(summary.error ? null : summary);
        } catch (e) {
            setDetectedEncoding(null);
            setPrettyXml('Invalid XML or Base64 Input');
            setSamlSummary({ error: 'Invalid XML or Base64 Input' });
        }
    };

    const handleAnalyzeSignature = async () => {
        try {
            const { xml } = await xmlService.decodeSamlInput(sigAnalyzerInput);

            const parser = new DOMParser();
            const doc = parser.parseFromString(xml, "text/xml");

            const parseError = doc.getElementsByTagName("parsererror")[0];
            if (parseError || doc.documentElement?.nodeName === "parsererror") {
                setSigAnalysis({ error: "Input could not be parsed as XML — check that it's fully decoded (see Inspector tab)." });
                return;
            }

            const DS_NS = "http://www.w3.org/2000/09/xmldsig#";
            const signatures = Array.from(doc.getElementsByTagNameNS(DS_NS, "Signature"));

            if (signatures.length === 0) {
                setSigAnalysis({ error: "No <ds:Signature> found in document." });
                return;
            }

            const getVal = (sig: Element, tag: string) =>
                sig.getElementsByTagNameNS(DS_NS, tag)[0]?.getAttribute("Algorithm") || "Not specified";

            // Walk up from each <ds:Signature> to label it by its nearest
            // meaningful SAML parent — real IdPs may sign the Assertion only,
            // the Response only, or both (double-signed).
            const getContextLabel = (sig: Element): string => {
                let el: Element | null = sig.parentElement;
                while (el) {
                    const localName = el.localName || el.tagName.split(':').pop() || el.tagName;
                    if (localName === 'Assertion') return 'Assertion';
                    if (localName === 'Response') return 'Response';
                    el = el.parentElement;
                }
                return 'Unknown context';
            };

            const results = signatures.map((sig) => ({
                context: getContextLabel(sig),
                canonicalization: getVal(sig, "CanonicalizationMethod"),
                signatureMethod: getVal(sig, "SignatureMethod"),
                digestMethod: getVal(sig, "DigestMethod"),
                keyInfo: !!sig.getElementsByTagNameNS(DS_NS, "KeyInfo")[0],
            }));

            setSigAnalysis({ signatures: results, found: true });
        } catch (e) {
            setSigAnalysis({ error: "Failed to parse XML for signature analysis." });
        }
    };

    const handleGenerateResponse = () => {
        const xml = xmlService.generateMockSamlResponse({
            issuer, subject, audience, acsUrl,
            attributes: { [attrName]: attrVal }
        });
        setPrettyXml(xmlService.formatXml(xml));
        setSamlSummary(parseSamlSummary(xml));
    };

    const handleGenerateRequest = () => {
        const xml = xmlService.generateMockSamlRequest({
            issuer: reqIssuer, acsUrl: reqAcsUrl, destination: reqDestination
        });
        setPrettyXml(xmlService.formatXml(xml));
        setSamlSummary(parseSamlSummary(xml));
    };

    const handleGenerateMetadata = () => {
        const xml = xmlService.generateMockSamlMetadata({
            entityId: metaEntityId, type: metaType,
            acsUrl: metaType === 'sp' ? reqAcsUrl : undefined,
            ssoUrl: metaType === 'idp' ? reqDestination : undefined
        });
        setPrettyXml(xmlService.formatXml(xml));
        setSamlSummary(parseSamlSummary(xml));
    };

    const sendToBase64 = () => {
        storageService.saveSessionState('base64-input', inspectorInput);
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
    };

    const loadExample = (type: 'google' | 'okta' | 'auth0') => {
        if (type === 'google') {
            setIssuer('https://accounts.google.com/o/saml2?idpid=C01234567');
            setSubject('alice.doe@example.com');
            setAudience('google.com/a/example.com');
        } else if (type === 'okta') {
            setIssuer('http://www.okta.com/exk1234567890abcdef');
            setSubject('bob.smith@okta.example.com');
            setAudience('https://sp.example.com/sso/saml');
        } else if (type === 'auth0') {
            setIssuer('urn:auth0:example-tenant');
            setSubject('carol.jones@example.com');
            setAudience('urn:auth0:example-tenant:example-sp');
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <ShieldCheckIcon className="h-8 w-8 text-sky-600" />
                        SAML Tools
                    </h2>
                    <p className="text-slate-600">Inspect, decode, and generate SAML Assertions, Requests, and Metadata.</p>
                </div>
                {activeView === 'Inspector' && samlSummary && !samlSummary.error && (
                    <div className="bg-slate-100 p-4 rounded-xl border border-slate-200 text-sm text-slate-700 max-w-md">
                        <h3 className="font-bold text-slate-900 mb-3">SAML Summary</h3>
                        <div className="grid grid-cols-1 gap-2 text-xs">
                            <div className="flex justify-between">
                                <span className="text-slate-500">Issuer</span>
                                <span className="font-mono text-slate-800 break-all">{samlSummary.issuer || '—'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Subject</span>
                                <span className="font-mono text-slate-800 break-all">{samlSummary.subject || '—'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Audience</span>
                                <span className="font-mono text-slate-800 break-all">{samlSummary.audience || '—'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Destination</span>
                                <span className="font-mono text-slate-800 break-all">{samlSummary.destination || '—'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Valid From</span>
                                <span className="font-mono text-slate-800 break-all">{samlSummary.notBefore || '—'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-slate-500">Valid Until</span>
                                <span className="font-mono text-slate-800 break-all">{samlSummary.notOnOrAfter || '—'}</span>
                            </div>
                        </div>
                        {samlSummary.attributes && samlSummary.attributes.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-slate-200">
                                <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-2">Attributes</h4>
                                <div className="space-y-1.5">
                                    {samlSummary.attributes.map((attr, idx) => (
                                        <div key={idx} className="flex items-start justify-between gap-3 group">
                                            <span className="text-slate-500 shrink-0">{attr.name}</span>
                                            <div className="flex items-center gap-1.5 min-w-0">
                                                <span className="font-mono text-slate-800 break-all text-right">{attr.value || '—'}</span>
                                                <button
                                                    onClick={() => copyAttrValue(attr.value, idx)}
                                                    className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-slate-400 hover:text-slate-700"
                                                    title="Copy value"
                                                >
                                                    {copiedAttrIndex === idx ? <CheckIcon className="h-3 w-3 text-green-600" /> : <ClipboardIcon className="h-3 w-3" />}
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Left Column: Controls */}
                <div className="lg:col-span-1 space-y-6">
                    <Tabs 
                        views={['Inspector', 'Response Gen', 'Request Gen', 'Metadata', 'Sig Analyzer']} 
                        activeView={activeView} 
                        setActiveView={setActiveView} 
                    />

                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 animate-fade-in">
                        {activeView === 'Inspector' && (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex justify-between items-center">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Input (XML / Base64)</label>
                                        <button 
                                            onClick={() => { setInspectorInput(''); setPrettyXml(''); setSigAnalysis(null); setDetectedEncoding(null); setSamlSummary(null); }}
                                            className="text-[10px] text-rose-600 hover:text-rose-700 font-bold uppercase tracking-tight flex items-center gap-1"
                                        >
                                            <TrashIcon className="h-3.5 w-3.5" /> Clear
                                        </button>
                                    </div>
                                    <textarea 
                                        rows={8} 
                                        className="block w-full rounded-lg border-slate-200 shadow-sm focus:ring-sky-500 text-xs font-mono" 
                                        placeholder="Paste SAMLResponse, AuthnRequest, or Base64 string..." 
                                        value={inspectorInput} 
                                        onChange={(e) => setInspectorInput(e.target.value)} 
                                    />
                                    <div className="flex gap-2">
                                        <button onClick={handleInspect} className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-white bg-slate-800 hover:bg-slate-900 font-bold text-sm transition-colors">
                                            <SearchIcon className="h-4 w-4" /> Decode
                                        </button>
                                        <button 
                                            onClick={sendToBase64} 
                                            className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-slate-700 bg-slate-100 hover:bg-slate-200 font-bold text-xs transition-colors border border-slate-200"
                                            title="Send content to Base64 Tool"
                                        >
                                            {copySuccess ? <CheckIcon className="h-4 w-4 text-green-600" /> : <SendIcon className="h-4 w-4" />}
                                            {copySuccess ? 'Sent!' : 'To Base64'}
                                        </button>
                                    </div>
                                </div>
                                <div className="bg-sky-50 p-4 rounded-lg border border-sky-100 text-xs text-sky-800 space-y-2">
                                    <h4 className="font-bold flex items-center gap-1"><BookIcon className="h-3 w-3" /> Quick Tip</h4>
                                    <p>The inspector automatically detects Base64-encoded SAML (HTTP-POST binding), and Base64 + DEFLATE-compressed, URL-encoded SAML (HTTP-Redirect binding).</p>
                                </div>
                            </div>
                        )}

                        {activeView === 'Response Gen' && (
                            <div className="space-y-4">
                                <div className="flex gap-2 mb-4">
                                    <button onClick={() => loadExample('google')} className="text-xs py-1 px-2 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-medium">Load Google Ex.</button>
                                    <button onClick={() => loadExample('okta')} className="text-xs py-1 px-2 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-medium">Load Okta Ex.</button>
                                    <button onClick={() => loadExample('auth0')} className="text-xs py-1 px-2 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 font-medium">Load Auth0 Ex.</button>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Issuer (IdP EntityID)</label>
                                    <input type="text" value={issuer} onChange={e => setIssuer(e.target.value)} className="block w-full rounded-md border-slate-200 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Subject (NameID)</label>
                                    <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className="block w-full rounded-md border-slate-200 text-sm" />
                                </div>
                                <div>
                                     <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Audience (SP EntityID)</label>
                                     <input type="text" value={audience} onChange={e => setAudience(e.target.value)} className="block w-full rounded-md border-slate-200 text-sm" />
                                </div>
                                <div className="pt-2">
                                    <button onClick={handleGenerateResponse} className="w-full py-2.5 rounded-lg text-white bg-sky-600 hover:bg-sky-700 font-bold text-sm transition-colors">Generate Mock Response</button>
                                </div>
                            </div>
                        )}

                        {activeView === 'Request Gen' && (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Issuer (SP EntityID)</label>
                                    <input type="text" value={reqIssuer} onChange={e => setReqIssuer(e.target.value)} className="block w-full rounded-md border-slate-200 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Destination (IdP SSO URL)</label>
                                    <input type="text" value={reqDestination} onChange={e => setReqDestination(e.target.value)} className="block w-full rounded-md border-slate-200 text-sm" />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">ACS URL</label>
                                    <input type="text" value={reqAcsUrl} onChange={e => setReqAcsUrl(e.target.value)} className="block w-full rounded-md border-slate-200 text-sm" />
                                </div>
                                <button onClick={handleGenerateRequest} className="w-full py-2.5 rounded-lg text-white bg-sky-600 hover:bg-sky-700 font-bold text-sm transition-colors">Generate Mock Request</button>
                            </div>
                        )}

                        {activeView === 'Metadata' && (
                            <div className="space-y-4">
                                 <div className="flex bg-slate-100 p-1 rounded-lg">
                                    <button onClick={() => setMetaType('sp')} className={`flex-1 py-1 px-2 rounded text-xs font-bold transition-all ${metaType === 'sp' ? 'bg-white shadow-sm text-sky-600' : 'text-slate-500'}`}>SP Metadata</button>
                                    <button onClick={() => setMetaType('idp')} className={`flex-1 py-1 px-2 rounded text-xs font-bold transition-all ${metaType === 'idp' ? 'bg-white shadow-sm text-sky-600' : 'text-slate-500'}`}>IdP Metadata</button>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Entity ID</label>
                                    <input type="text" value={metaEntityId} onChange={e => setMetaEntityId(e.target.value)} className="block w-full rounded-md border-slate-200 text-sm" />
                                </div>
                                <div className="text-xs text-slate-500 p-2 bg-slate-50 rounded">
                                    Generates standard XML metadata for setting up trust between IdP and SP.
                                </div>
                                <button onClick={handleGenerateMetadata} className="w-full py-2.5 rounded-lg text-white bg-sky-600 hover:bg-sky-700 font-bold text-sm transition-colors">Generate Metadata</button>
                            </div>
                        )}

                        {activeView === 'Sig Analyzer' && (
                            <div className="space-y-4">
                                <div className="space-y-2">
                                     <div className="flex justify-between items-center">
                                        <label className="text-xs font-bold text-slate-500 uppercase">Input (XML / Base64)</label>
                                        <button 
                                            onClick={() => { setSigAnalyzerInput(''); setSigAnalysis(null); }}
                                            className="text-[10px] text-rose-600 hover:text-rose-700 font-bold uppercase tracking-tight flex items-center gap-1"
                                        >
                                            <TrashIcon className="h-3.5 w-3.5" /> Clear
                                        </button>
                                    </div>
                                    <textarea 
                                        rows={8} 
                                        className="block w-full rounded-lg border-slate-200 shadow-sm focus:ring-sky-500 text-xs font-mono" 
                                        placeholder="Paste signed SAML XML..." 
                                        value={sigAnalyzerInput} 
                                        onChange={(e) => setSigAnalyzerInput(e.target.value)} 
                                    />
                                    <button onClick={handleAnalyzeSignature} className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-white bg-slate-800 hover:bg-slate-900 font-bold text-sm transition-colors">
                                        <ShieldCheckIcon className="h-4 w-4" /> Analyze Signature
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Educational Content Section - Context Aware */}
                    <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 animate-fade-in">
                        <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                            <BookIcon className="h-4 w-4 text-sky-500" />
                            {activeView === 'Inspector' ? 'About SAML Content' : 
                             activeView.includes('Gen') ? 'SAML Fields Explained' : 
                             activeView === 'Metadata' ? 'About Metadata' : 'SAML Signatures'}
                        </h3>
                        <div className="text-xs text-slate-600 space-y-2 leading-relaxed">
                            {activeView === 'Inspector' && (
                                <>
                                    <p><strong>SAMLResponse:</strong> The XML token sent from the IdP to the SP containing user identity (Subject) and attributes.</p>
                                    <p><strong>AuthnRequest:</strong> The request sent from SP to IdP to initiate login.</p>
                                    <p>These are often Base64 encoded and passed via <code>SAMLRequest</code> or <code>SAMLResponse</code> form parameters.</p>
                                </>
                            )}
                            {(activeView === 'Response Gen' || activeView === 'Request Gen') && (
                                <>
                                    <p><strong>Issuer:</strong> The unique EntityID of the system sending the message.</p>
                                    <p><strong>Subject (NameID):</strong> The username or email identifying the authenticated user.</p>
                                    <p><strong>Audience:</strong> The EntityID of the intended recipient (SP).</p>
                                    <p><strong>Destination:</strong> The specific URL where the message is being sent.</p>
                                </>
                            )}
                             {activeView === 'Metadata' && (
                                <>
                                    <p><strong>Metadata:</strong> XML document used to exchange configuration between IdP and SP. Contains certificates, URLs (ACS, SSO), and EntityIDs.</p>
                                    <p>Exchanging metadata is usually the first step in setting up a SAML connection.</p>
                                </>
                            )}
                             {activeView === 'Sig Analyzer' && (
                                <>
                                    <p>SAML relies on <strong>XML Digital Signatures (XML-DSig)</strong> to ensure integrity.</p>
                                    <p>Signatures can be applied to the entire <code>Response</code>, the <code>Assertion</code>, or both.</p>
                                    <p>Common transformations (Canonicalization) are needed to ensure the XML matches exactly what was signed.</p>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column: Output */}
                <div className="lg:col-span-2">
                    <div className="bg-slate-900 rounded-xl shadow-lg border border-slate-800 overflow-hidden min-h-[600px] flex flex-col relative group">
                        <div className="bg-slate-800 px-4 py-3 border-b border-slate-700 flex justify-between items-center">
                            <span className="text-[10px] font-mono font-black text-slate-500 tracking-tighter uppercase">XML Output</span>
                            {activeView === 'Inspector' && detectedEncoding && (
                                <span className="text-[10px] font-mono font-bold text-cyan-400 tracking-tight">
                                    Detected: {detectedEncoding}
                                </span>
                            )}
                        </div>
                        <div className="p-0 flex-1 overflow-auto bg-[rgba(15,23,42,0.5)]">
                            {activeView === 'Sig Analyzer' && sigAnalysis ? (
                                <div className="p-4 space-y-4 animate-fade-in">
                                    {sigAnalysis.error ? (
                                        <div className="p-4 bg-red-900/30 border border-red-500/50 rounded-lg text-red-200 text-xs font-mono">
                                            {sigAnalysis.error}
                                        </div>
                                    ) : (
                                        <div className="space-y-4">
                                            {sigAnalysis.signatures.length > 1 && (
                                                <p className="text-[10px] uppercase font-bold text-amber-400 tracking-tight pl-1">
                                                    {sigAnalysis.signatures.length} signatures found
                                                </p>
                                            )}
                                            {sigAnalysis.signatures.map((sig: any, idx: number) => (
                                                <div key={idx} className="border border-slate-700 rounded-lg overflow-hidden">
                                                    <div className="bg-slate-800/80 px-3 py-2 text-[10px] font-bold uppercase tracking-tight text-slate-300">
                                                        Signature {idx + 1} — {sig.context}-level
                                                    </div>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                                                        <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-2">Canonicalization</h4>
                                                            <p className="text-cyan-300 font-mono text-xs">{sig.canonicalization}</p>
                                                        </div>
                                                        <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-2">Signature Method</h4>
                                                            <p className="text-cyan-300 font-mono text-xs">{sig.signatureMethod}</p>
                                                        </div>
                                                        <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-2">Digest Method</h4>
                                                            <p className="text-cyan-300 font-mono text-xs">{sig.digestMethod}</p>
                                                        </div>
                                                        <div className="p-4 bg-slate-800/50 rounded-lg border border-slate-700">
                                                            <h4 className="text-[10px] font-bold text-slate-500 uppercase mb-2">KeyInfo</h4>
                                                            <p className={`font-mono text-xs ${sig.keyInfo ? 'text-green-400' : 'text-red-400'}`}>{sig.keyInfo ? 'Present' : 'Missing'}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                     {prettyXml && (
                                        <div className="mt-4">
                                              <p className="text-[10px] uppercase font-bold text-slate-500 mb-2 pl-1">Document Context</p>
                                             <CodeBlock content={prettyXml} language="xml" />
                                        </div>
                                    )}
                                </div>
                            ) : prettyXml ? (
                                <div className="p-0">
                                    <CodeBlock content={prettyXml} language="xml" />
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-700 p-8">
                                    <FileCodeIcon className="h-16 w-16 mb-4 opacity-10" />
                                    <p className="text-sm font-medium">Generated or decoded XML will appear here.</p>
                                    <p className="text-xs text-slate-600 mt-2 text-center max-w-xs">Use the tools on the left to inspect existing SAML messages or generate new ones for testing.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SamlTools;
