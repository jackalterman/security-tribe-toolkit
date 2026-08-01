
import React, { useState, useEffect, useMemo } from 'react';
import { providerConfigs, ProviderConfig } from '../services/providerConfig';
import { jwtService } from '../services/jwtService';
import { xmlService } from '../services/xmlService';
import { DecoderData } from '../types';
import { UsersIcon, ServerIcon, SendIcon, SettingsIcon, KeyIcon } from './icons';
import type { DetectedFlow, RealFlowStep } from '../services/harFlowDetector';

interface FlowVisualizerProps {
  onSendToDecoder: (data: DecoderData) => void;
  /** When provided, the visualizer renders this real, HAR-reconstructed flow instead of demo/mock data. */
  initialFlowData?: DetectedFlow | null;
  /** Called once the real flow data has been consumed, mirroring the onDataHandled convention used for the JWT decoder. */
  onFlowDataHandled?: () => void;
}

// SVG Components
const Node: React.FC<{ x: number; y: number; title: string; icon: React.ReactNode; active: boolean }> = ({ x, y, title, icon, active }) => (
    <g transform={`translate(${x}, ${y})`} className="transition-all duration-500">
        <circle cx="0" cy="0" r="35" className={`${active ? 'fill-sky-100 stroke-sky-500' : 'fill-white stroke-slate-300'} stroke-2 transition-colors duration-500`} />
        <foreignObject x="-20" y="-20" width="40" height="40">
            <div className={`flex items-center justify-center h-full w-full ${active ? 'text-sky-600' : 'text-slate-400'}`}>
                {React.cloneElement(icon as React.ReactElement, { className: "w-8 h-8" })}
            </div>
        </foreignObject>
        <text x="0" y="55" textAnchor="middle" className={`text-sm font-semibold ${active ? 'fill-sky-700' : 'fill-slate-500'}`}>{title}</text>
    </g>
);

const Connection: React.FC<{ from: {x: number, y: number}, to: {x: number, y: number}, active: boolean }> = ({ from, to, active }) => {
     const angle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
     const length = Math.sqrt(Math.pow(to.x - from.x, 2) + Math.pow(to.y - from.y, 2));

     return (
        <g transform={`translate(${from.x}, ${from.y}) rotate(${angle})`}>
            <line x1="35" y1="0" x2={length - 35} y2="0" className={`${active ? 'stroke-sky-400' : 'stroke-slate-200'} stroke-2`} strokeDasharray="4 4" />
             {active && (
                 <path d={`M ${length - 40} -5 L ${length - 35} 0 L ${length - 40} 5`} className="fill-none stroke-sky-500 stroke-2" />
             )}
        </g>
     );
}

const Packet: React.FC<{ from: {x: number, y: number}, to: {x: number, y: number}, label: string }> = ({ from, to, label }) => {
    return (
        <g>
            <circle r="6" className="fill-sky-500">
                <animateMotion
                    dur="1.5s"
                    repeatCount="indefinite"
                    path={`M${from.x},${from.y} L${to.x},${to.y}`}
                    keyPoints="0.1;0.9"
                    keyTimes="0;1"
                />
            </circle>
             <text x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 10} textAnchor="middle" className="text-xs fill-sky-600 font-mono bg-white">{label}</text>
        </g>
    )
}

const getOauthSteps = (provider: ProviderConfig) => [
  { 
    title: "1. User Initiates Login",
    description: `The user clicks 'Login'. The app redirects the browser to ${provider.name}'s authorization endpoint.`,
    from: 'user', to: 'client',
    nodes: { active: ['user', 'client'], packet: { from: 'user', to: 'client', label: 'Click' } },
    details: {
        type: 'Browser Redirect',
        content: `GET ${provider.authorizeEndpoint}?
  response_type=code
  &client_id=CLIENT_123
  &redirect_uri=https://app.com/cb
  &scope=${provider.scopes.slice(0, 2).join(' ')}`
    }
  },
  {
    title: "2. Redirect to Auth Server",
    description: `The Client App redirects the browser to ${provider.name}.`,
    from: 'client', to: 'auth',
    nodes: { active: ['client', 'auth'], packet: { from: 'client', to: 'auth', label: 'Redirect' } },
    details: null
  },
  {
    title: "3. Authentication & Consent",
    description: `The user authenticates with ${provider.name} and grants permissions.`,
    from: 'user', to: 'auth',
    nodes: { active: ['user', 'auth'], packet: { from: 'user', to: 'auth', label: 'Creds' } },
    details: null
  },
  {
    title: "4. Authorization Code Issue",
    description: `${provider.name} redirects back with a short-lived 'Authorization Code'.`,
    from: 'auth', to: 'client',
    nodes: { active: ['auth', 'client'], packet: { from: 'auth', to: 'client', label: 'code=xyz' } },
    details: {
        type: 'Callback URL',
        content: `GET https://app.com/cb?code=AUTH_CODE_XYZ`
    }
  },
  {
    title: "5. Token Exchange (Backchannel)",
    description: "Client exchanges the code for tokens directly with the provider.",
    from: 'client', to: 'auth',
    nodes: { active: ['client', 'auth'], packet: { from: 'client', to: 'auth', label: 'POST /token' } },
    details: {
        type: 'POST Request',
        content: `POST ${provider.tokenEndpoint}
grant_type=authorization_code
&code=AUTH_CODE_XYZ
&client_secret=SECRET_KEY`
    }
  },
  {
    title: "6. Tokens Returned",
    description: `${provider.name} returns an Access Token and ID Token.`,
    from: 'auth', to: 'client',
    nodes: { active: ['auth', 'client'], packet: { from: 'auth', to: 'client', label: '{ tokens }' } },
    details: {
        type: 'JSON Response',
        content: `{
  "access_token": "eyJhbG...",
  "id_token": "eyJraWQ...",
  "expires_in": 3600
}`
    }
  },
  {
    title: "7. Access Resource",
    description: "Client uses the Access Token to fetch data from the Resource Server (API) or UserInfo endpoint.",
    from: 'client', to: 'api',
    nodes: { active: ['client', 'api'], packet: { from: 'client', to: 'api', label: 'Bearer Token' } },
    details: {
        type: 'API Request',
        content: `GET ${provider.userInfoEndpoint}
Authorization: Bearer eyJhbG...`
    }
  },
];

const getSamlSteps = (provider: ProviderConfig) => [
    {
        title: "1. Access Attempt",
        description: "User attempts to access a secured resource on the Service Provider (SP).",
        from: 'user', to: 'client',
        nodes: { active: ['user', 'client'], packet: { from: 'user', to: 'client', label: 'Request' } },
        details: { type: 'HTTP Request', content: 'GET /secured-resource' }
    },
    {
        title: "2. Redirect to IdP",
        description: `SP redirects browser to ${provider.name} (the IdP) with a SAMLRequest.`,
        from: 'client', to: 'auth',
        nodes: { active: ['client', 'auth'], packet: { from: 'client', to: 'auth', label: 'SAMLRequest' } },
        details: { type: 'HTTP 302 Redirect', content: `Location: ${provider.authorizeEndpoint}?SAMLRequest=...` }
    },
    {
        title: "3. Authentication",
        description: `User authenticates with ${provider.name}.`,
        from: 'user', to: 'auth',
        nodes: { active: ['user', 'auth'], packet: { from: 'user', to: 'auth', label: 'Login' } },
        details: null
    },
    {
        title: "4. SAML Response Generation",
        description: `${provider.name} generates a signed SAML Response.`,
        from: 'auth', to: 'user',
        nodes: { active: ['auth', 'user'], packet: { from: 'auth', to: 'user', label: 'Form HTML' } },
        details: { type: 'HTML Form', content: '<form action="https://sp.com/acs" method="POST">...</form>' }
    },
    {
        title: "5. POST to SP (ACS)",
        description: "Browser POSTs the signed SAMLResponse to the SP's Assertion Consumer Service.",
        from: 'user', to: 'client',
        nodes: { active: ['user', 'client'], packet: { from: 'user', to: 'client', label: 'SAMLResponse' } },
        details: { type: 'HTTP POST', content: 'SAMLResponse=PHNhbWxwOlJlc3Bvbn...' }
    },
    {
        title: "6. Session Established",
        description: "SP verifies the signature and attributes, then creates a local session.",
        from: 'client', to: 'client',
        nodes: { active: ['client'], packet: { from: 'client', to: 'client', label: 'Session' } },
        details: null
    }
];

const getDeviceSteps = (provider: ProviderConfig) => [
    {
        title: "1. Device Code Request",
        description: "The input-constrained device calls the Auth Server to start flow.",
        from: 'client', to: 'auth',
        nodes: { active: ['client', 'auth'], packet: { from: 'client', to: 'auth', label: 'POST /device' } },
        details: { type: 'POST', content: `POST ${provider.tokenEndpoint}/device\nclient_id=123&scope=openid` }
    },
    {
        title: "2. Code Display",
        description: `${provider.name} returns a \`user_code\` and \`verification_uri\`.`,
        from: 'auth', to: 'client',
        nodes: { active: ['auth', 'client'], packet: { from: 'auth', to: 'client', label: 'user_code' } },
        details: { type: 'JSON', content: '{"user_code": "BCD-123", "verification_uri": "app.com/activate"}' }
    },
    {
        title: "3. User Activation",
        description: "User takes out their phone, goes to the URI, and enters the code.",
        from: 'user', to: 'auth',
        nodes: { active: ['user', 'auth'], packet: { from: 'user', to: 'auth', label: 'Enter Code' } },
        details: { type: 'Browser', content: 'User enters "BCD-123"' }
    },
    {
        title: "4. Polling",
        description: "The Device polls the Auth Server: 'Is the user done yet?'",
        from: 'client', to: 'auth',
        nodes: { active: ['client', 'auth'], packet: { from: 'client', to: 'auth', label: 'Poll...' } },
        details: { type: 'POST /token', content: 'grant_type=device_code&device_code=...' }
    },
    {
        title: "5. Token Issue",
        description: "Once user approves, the next poll receives the tokens.",
        from: 'auth', to: 'client',
        nodes: { active: ['auth', 'client'], packet: { from: 'auth', to: 'client', label: '{ tokens }' } },
        details: { type: 'JSON', content: '{"access_token": "..."}' }
    }
];

// --- Real HAR flow adaptation -------------------------------------------------
// Maps a DetectedFlow (from services/harFlowDetector.ts) onto the same step
// shape the mock generators above produce, so the existing SVG/step UI can
// render real data without any chrome changes. This chunk only wires
// oauth-oidc flows (the only kind the detector currently reconstructs), so
// the from/to pairing below is fixed to that 4-step shape. SAML wiring
// (Chunk 4) will need to generalize this once SAML flows carry more steps.
const REAL_OAUTH_STEP_NODE_PAIRS: { from: string; to: string }[] = [
  { from: 'client', to: 'auth' }, // Redirect to IdP
  { from: 'user', to: 'auth' },   // Authentication at IdP
  { from: 'auth', to: 'client' }, // Callback to Pega (SP)
  { from: 'client', to: 'auth' }, // Token Exchange (backchannel, usually uncaptured)
];

const buildRealStepDetails = (step: RealFlowStep) => {
  if (!step.captured) {
    return {
      type: 'Not Captured',
      content: 'This step is not visible in the HAR — it likely happened server-side or was not proxied by the browser.',
    };
  }
  const lines: string[] = [];
  if (step.request) {
    lines.push(`${step.request.method} ${step.request.url}`);
    if (step.request.body) {
      lines.push('');
      lines.push(step.request.body);
    }
  }
  if (step.response) {
    lines.push('');
    lines.push(`→ HTTP ${step.response.status}`);
  }
  return { type: 'Real HAR Data', content: lines.join('\n') || 'No request/response body captured.' };
};

const stepsFromRealFlow = (flow: DetectedFlow) => flow.steps.map((step, i) => {
  const pair = REAL_OAUTH_STEP_NODE_PAIRS[i] || { from: 'client', to: 'auth' };
  return {
    title: `${i + 1}. ${step.title}`,
    description: step.description,
    nodes: {
      active: [pair.from, pair.to],
      packet: { from: pair.from, to: pair.to, label: step.captured ? 'Real' : 'Inferred' },
    },
    details: buildRealStepDetails(step),
    captured: step.captured,
  };
});

const FlowVisualizer: React.FC<FlowVisualizerProps> = ({ onSendToDecoder, initialFlowData, onFlowDataHandled }) => {
  const [flowType, setFlowType] = useState<'oauth' | 'saml' | 'device'>('oauth');
  const [providerId, setProviderId] = useState<string>('generic');
  const [currentStep, setCurrentStep] = useState(0);
  const [generatedData, setGeneratedData] = useState<string>('');
  const [realFlow, setRealFlow] = useState<DetectedFlow | null>(initialFlowData ?? null);

  useEffect(() => {
    if (initialFlowData) {
      setRealFlow(initialFlowData);
      setCurrentStep(0);
    }
  }, [initialFlowData]);

  const exitRealFlowMode = () => {
    setRealFlow(null);
    onFlowDataHandled?.();
  };

  const provider = providerConfigs[providerId];
  const mockSteps = flowType === 'oauth' ? getOauthSteps(provider) : (flowType === 'saml' ? getSamlSteps(provider) : getDeviceSteps(provider));
  // Loosely typed on purpose: mock steps and real-flow steps share the same
  // shape in practice (title/description/nodes/details) but real steps also
  // carry a `captured` flag mock steps don't have.
  const steps: any[] = realFlow ? stepsFromRealFlow(realFlow) : mockSteps;

  const realFlowToken = useMemo(() => {
    if (!realFlow) return null;
    for (const s of realFlow.steps) {
      const url = s.request?.url;
      if (!url) continue;
      try {
        const params = new URL(url).searchParams;
        const candidate = params.get('id_token') || params.get('access_token');
        if (candidate && jwtService.decode(candidate)) return candidate;
      } catch {
        // ignore malformed URLs
      }
    }
    return null;
  }, [realFlow]);

  useEffect(() => {
      if (realFlow) return; // don't regenerate demo data while viewing a reconstructed HAR flow
      setCurrentStep(0);
      generateData();
  }, [flowType, providerId]);

  const generateData = async () => {
    if (flowType !== 'saml') {
        const header = { alg: 'HS256', typ: 'JWT' };
        const payload = { 
            iss: provider.issuer,
            sub: 'user-789',
            aud: 'https://api.resource-server.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
            scope: provider.scopes.join(' ')
        };
        const token = await jwtService.sign(header, payload, 'super-secret-key-for-resource-server');
        setGeneratedData(token);
    } else {
        const xml = xmlService.generateMockSamlResponse({
            issuer: provider.issuer,
            subject: 'user@example.com',
            audience: 'https://sp.example.com',
            acsUrl: 'https://sp.example.com/acs',
            attributes: { role: 'admin' }
        });
        setGeneratedData(xml);
    }
  };

  const handleNext = () => setCurrentStep(prev => Math.min(prev + 1, steps.length - 1));
  const handlePrev = () => setCurrentStep(prev => Math.max(prev - 1, 0));
  
  const handleInspect = () => {
      if (flowType !== 'saml') {
          onSendToDecoder({
            token: generatedData,
            key: 'super-secret-key-for-resource-server',
            audience: 'https://api.resource-server.com',
            issuer: 'https://auth-server.com',
        });
      } else {
          alert("SAML data generated! Go to the 'SAML' tab and paste it to inspect.");
      }
  };

  const step = steps[currentStep];
  
  const coords: Record<string, {x: number, y: number}> = {
      user: { x: 100, y: 200 },
      client: { x: 300, y: 300 },
      auth: { x: 500, y: 100 },
      api: { x: 700, y: 300 },
  };

  const isConnectionActive = (n1: string, n2: string) => {
      const a = step.nodes.active;
      return a.includes(n1) && a.includes(n2);
  }

  const showApiNode = !realFlow && flowType === 'oauth';
  const clientTitle = realFlow ? 'Pega (SP / Client)' : (flowType === 'saml' ? "Service Provider" : (flowType === 'device' ? "Device (TV)" : "Client App"));
  const authTitle = realFlow ? realFlow.idpDisplayName : (flowType === 'saml' ? "Identity Provider" : "Auth Server");

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
         <div className="flex-1">
             <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                Flow Visualizer
                <span className={`text-[10px] uppercase tracking-widest px-2 py-0.5 rounded border ${realFlow ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : provider.id === 'google' ? 'bg-red-50 text-red-600 border-red-100' : provider.id === 'microsoft' ? 'bg-blue-50 text-blue-600 border-blue-100' : provider.id === 'okta' ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-slate-50 text-slate-600 border-slate-100'}`}>
                    {realFlow ? realFlow.idpDisplayName : provider.name}
                </span>
             </h2>
             <p className="text-slate-600">
                {realFlow
                    ? `Reconstructed from a real HAR capture — ${realFlow.idpDisplayName} → Pega.`
                    : 'Interactive walkthroughs of standard authentication protocols.'}
             </p>
         </div>
         
         {realFlow ? (
         <div className="flex items-center gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5 shadow-sm">
             <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shrink-0" />
             <span className="text-xs font-bold text-emerald-800">Viewing a real login captured in a HAR file</span>
             <button
                 onClick={exitRealFlowMode}
                 className="ml-2 text-xs font-bold text-emerald-700 hover:text-emerald-900 underline underline-offset-2"
             >
                 Exit to Demo Mode
             </button>
         </div>
         ) : (
         <div className="flex flex-col sm:flex-row gap-4">
            <div className="bg-white p-1 rounded-xl shadow-sm border border-slate-200 flex gap-1">
                {Object.values(providerConfigs).map(p => (
                    <button 
                        key={p.id}
                        onClick={() => setProviderId(p.id)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${providerId === p.id ? 'bg-slate-900 text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
                    >
                        {p.name.split(' ')[0]}
                    </button>
                ))}
            </div>

            <div className="bg-slate-100 p-1 rounded-xl flex gap-1">
                <button 
                    onClick={() => setFlowType('oauth')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${flowType === 'oauth' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    OAuth 2.0
                </button>
                <button 
                    onClick={() => setFlowType('saml')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${flowType === 'saml' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    SAML 2.0
                </button>
                <button 
                    onClick={() => setFlowType('device')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${flowType === 'device' ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Device Flow
                </button>
            </div>
         </div>
         )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="bg-slate-50 border-b border-slate-200 relative h-[400px]">
            <svg width="100%" height="100%" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid meet">
                <Connection from={coords.user} to={coords.client} active={isConnectionActive('user', 'client')} />
                <Connection from={coords.client} to={coords.auth} active={isConnectionActive('client', 'auth')} />
                <Connection from={coords.user} to={coords.auth} active={isConnectionActive('user', 'auth')} />
                <Connection from={coords.auth} to={coords.client} active={isConnectionActive('auth', 'client')} />
                {showApiNode && <Connection from={coords.client} to={coords.api} active={isConnectionActive('client', 'api')} />}

                <Node x={coords.user.x} y={coords.user.y} title={flowType === 'device' ? "User (Phone)" : "User Agent"} icon={<UsersIcon />} active={step.nodes.active.includes('user')} />
                <Node x={coords.client.x} y={coords.client.y} title={clientTitle} icon={<SettingsIcon />} active={step.nodes.active.includes('client')} />
                <Node x={coords.auth.x} y={coords.auth.y} title={authTitle} icon={<KeyIcon />} active={step.nodes.active.includes('auth')} />
                {showApiNode && <Node x={coords.api.x} y={coords.api.y} title="API" icon={<ServerIcon />} active={step.nodes.active.includes('api')} />}

                <Packet from={coords[step.nodes.packet.from]} to={coords[step.nodes.packet.to]} label={step.nodes.packet.label} />
            </svg>
            
            <div className="absolute top-4 left-4 flex gap-2">
                <div className="bg-white/80 backdrop-blur rounded-full px-3 py-1 text-xs font-bold text-slate-500 border border-slate-200">
                    Step {currentStep + 1} of {steps.length}
                </div>
                <div className={`bg-white/80 backdrop-blur rounded-full px-3 py-1 text-xs font-bold border border-slate-200 ${realFlow ? 'text-emerald-600' : providerId === 'google' ? 'text-red-500' : providerId === 'microsoft' ? 'text-blue-500' : providerId === 'okta' ? 'text-indigo-500' : 'text-slate-500'}`}>
                    {realFlow ? `${realFlow.idpDisplayName} → Pega` : `${provider.name} Context`}
                </div>
                {realFlow && !step.captured && (
                    <div className="bg-amber-100/90 backdrop-blur rounded-full px-3 py-1 text-xs font-bold border border-amber-200 text-amber-700">
                        Not captured in HAR
                    </div>
                )}
            </div>
        </div>

        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between gap-4">
                    <h3 className="text-xl font-bold text-slate-800">{step.title}</h3>
                    <div className="flex gap-2 shrink-0">
                        <button onClick={handlePrev} disabled={currentStep === 0} className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                            Previous
                        </button>
                        <button onClick={handleNext} disabled={currentStep === steps.length - 1} className="px-4 py-2 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                            Next
                        </button>
                    </div>
                </div>
                <p className="text-slate-600 leading-relaxed">{step.description}</p>
                
                {step.details && (
                    <div className="mt-4 bg-slate-900 rounded-xl p-5 text-slate-300 font-mono text-xs overflow-x-auto border border-slate-700 shadow-2xl relative group">
                        <div className="absolute top-4 right-4 text-slate-600 uppercase text-[10px] font-bold tracking-widest">{step.details.type}</div>
                        <pre className="mt-2">{step.details.content}</pre>
                    </div>
                )}
            </div>

            <div className="lg:border-l border-slate-100 lg:pl-8 space-y-6">
                <div className="p-4 bg-sky-50 rounded-xl border border-sky-100">
                    <h4 className="text-sm font-bold text-sky-900 mb-2 flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse"></div>
                        Protocol Insight
                    </h4>
                    <ul className="text-sm text-sky-800 space-y-2 list-disc list-inside">
                        {step.nodes.active.includes('user') && <li>User Agent mediation required.</li>}
                        {step.nodes.active.includes('client') && <li>Client logic processes redirect.</li>}
                        {step.nodes.active.includes('auth') && <li>{realFlow ? realFlow.idpDisplayName : provider.name} validates request.</li>}
                    </ul>
                </div>

                {realFlow ? (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                        <h4 className="text-sm font-bold text-slate-900 mb-3">Source HAR Requests</h4>
                        <div className="space-y-1 text-[11px] text-slate-500 font-mono">
                            {realFlow.sourceEntryIds.length > 0
                                ? realFlow.sourceEntryIds.map(id => <div key={id} className="truncate">{id}</div>)
                                : <div className="italic">No matched entry IDs</div>}
                        </div>
                        {realFlow.issuer && (
                            <div className="mt-3 pt-3 border-t border-slate-200 text-[11px] text-slate-600">
                                <span className="font-bold text-slate-700">Issuer:</span> <span className="font-mono break-all">{realFlow.issuer}</span>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                        <h4 className="text-sm font-bold text-slate-900 mb-3">{provider.name} Tips</h4>
                        <div className="space-y-4">
                            {provider.quirks.map((quirk, idx) => (
                                <div key={idx} className="space-y-1">
                                    <div className="text-xs font-bold text-slate-700">{quirk.title}</div>
                                    <div className="text-[11px] text-slate-500 leading-relaxed">{quirk.description}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {realFlow ? (
                    realFlowToken && (
                        <button
                            onClick={() => onSendToDecoder({ token: realFlowToken, key: '', issuer: realFlow.issuer })}
                            className="w-full flex items-center justify-center gap-2 py-4 px-4 border border-transparent shadow-lg text-sm font-bold rounded-xl text-white bg-slate-800 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 transition-all hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <SendIcon className="h-4 w-4" />
                            Inspect Real Token
                        </button>
                    )
                ) : (
                    ((flowType === 'oauth' && currentStep >= 5) || (flowType === 'device' && currentStep === 4)) && (
                        <button onClick={handleInspect} className="w-full flex items-center justify-center gap-2 py-4 px-4 border border-transparent shadow-lg text-sm font-bold rounded-xl text-white bg-slate-800 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 transition-all hover:scale-[1.02] active:scale-[0.98]">
                            <SendIcon className="h-4 w-4" />
                            Inspect Token
                        </button>
                    )
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default FlowVisualizer;
