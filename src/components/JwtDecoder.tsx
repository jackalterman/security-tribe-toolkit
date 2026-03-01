import React, { useState, useEffect } from 'react';
import CodeBlock from './CodeBlock';
import JsonViewer from './JsonViewer';
import { jwtService } from '../services/jwtService';
import { storageService } from '../services/storageService';
import { getJwtDecoderState, saveJwtDecoderState, JwtDecoderState } from '../services/jwtStorage';
import { DecodedJwt, VerificationResult, DecoderData } from '../types';
import { CheckIcon, AlertTriangleIcon, SaveIcon, RefreshIcon } from './icons';

interface JwtDecoderProps {
  initialData: DecoderData | null;
  onDataHandled: () => void;
}

const JwtDecoder: React.FC<JwtDecoderProps> = ({ initialData, onDataHandled }) => {
  const [token, setToken] = useState('');
  const [key, setKey] = useState('your-256-bit-secret');
  const [audience, setAudience] = useState('');
  const [issuer, setIssuer] = useState('');
  const [decoded, setDecoded] = useState<DecodedJwt | null>(null);
  const [verification, setVerification] = useState<VerificationResult | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load state from IndexedDB
  useEffect(() => {
    const loadState = async () => {
      try {
        const savedState = await getJwtDecoderState();
        if (savedState) {
          setToken(savedState.token);
          setKey(savedState.key);
          setAudience(savedState.audience);
          setIssuer(savedState.issuer);
        }
      } catch (err) {
        console.error('Failed to load decoder state', err);
      } finally {
        setIsLoaded(true);
      }
    };
    loadState();
  }, []);

  // Save state to IndexedDB
  useEffect(() => {
    if (!isLoaded) return;
    const state: JwtDecoderState = { token, key, audience, issuer };
    saveJwtDecoderState(state).catch(err => console.error('Failed to save decoder state', err));
  }, [isLoaded, token, key, audience, issuer]);

  useEffect(() => {
    if (initialData && isLoaded) {
      setToken(initialData.token || '');
      setKey(initialData.key || 'your-256-bit-secret');
      setAudience(initialData.audience || '');
      setIssuer(initialData.issuer || '');
      onDataHandled();
    }
  }, [initialData, onDataHandled, isLoaded]);

  useEffect(() => {
    const decodedToken = jwtService.decode(token);
    setDecoded(decodedToken);
    setVerification(null);
  }, [token]);

  const handleVerify = async () => {
    if (token) {
      const options: { audience?: string; issuer?: string } = {};
      if (audience.trim()) options.audience = audience.trim();
      if (issuer.trim()) options.issuer = issuer.trim();
      const result = await jwtService.verify(token, key, options);
      setVerification(result);
    }
  };

  const renderVerificationStatus = () => {
    if (!verification) return null;
    if (verification.isValid) {
      return (
        <div className="p-4 mt-4 bg-green-50 border border-green-200 rounded-lg flex items-start space-x-3 animate-fade-in">
          <div className="bg-green-100 rounded-full p-1">
            <CheckIcon className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <p className="font-bold text-green-900">Signature Verified</p>
            <p className="text-sm text-green-700 mt-1">{verification.reason}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="p-4 mt-4 bg-red-50 border border-red-200 rounded-lg flex items-start space-x-3 animate-fade-in">
        <div className="bg-red-100 rounded-full p-1">
            <AlertTriangleIcon className="h-5 w-5 text-red-600" />
        </div>
        <div>
          <p className="font-bold text-red-900">Verification Failed</p>
          <p className="text-sm text-red-700 mt-1">{verification.reason}</p>
        </div>
      </div>
    );
  };

  const isAsymmetric = decoded?.header?.alg === 'RS256' || decoded?.header?.alg === 'ES256';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-6">
         <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">JWT Decoder</h2>
            <p className="text-slate-600">Inspect a token's contents and verify its signature.</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-5">
            <div>
                <label htmlFor="jwt-input" className="block text-sm font-semibold text-slate-700 mb-1">JWT</label>
                <textarea
                    id="jwt-input"
                    rows={6}
                    className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm font-mono"
                    placeholder="Paste your JWT here..."
                    value={token}
                    onChange={(e) => setToken(e.target.value)}
                />
            </div>

            <div className="pt-4 border-t border-slate-100 space-y-4">
                <h3 className="font-semibold text-slate-900">Verification Options</h3>
                
                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label htmlFor="jwt-verify-key" className="block text-sm font-medium text-slate-700">
                            {isAsymmetric ? 'Public Key (PEM)' : 'HMAC Secret'}
                        </label>
                        <button 
                            onClick={() => setShowSecret(!showSecret)}
                            className="text-xs text-sky-600 hover:text-sky-700 font-medium"
                        >
                            {showSecret ? 'Hide' : 'Show'}
                        </button>
                    </div>
                    {isAsymmetric ? (
                        <textarea
                        id="jwt-verify-key"
                        className={`block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-xs font-mono bg-slate-50 ${!showSecret ? 'text-transparent tracking-tighter select-none' : ''}`}
                        rows={6}
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        placeholder="Paste Public Key (PEM) here."
                        style={{ textShadow: !showSecret ? '0 0 8px rgba(0,0,0,0.5)' : 'none' }}
                        />
                    ) : (
                        <input
                        id="jwt-verify-key"
                        type={showSecret ? "text" : "password"}
                        className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm font-mono"
                        value={key}
                        onChange={(e) => setKey(e.target.value)}
                        />
                    )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label htmlFor="jwt-verify-audience" className="block text-sm font-medium text-slate-700 mb-1">Expected Audience (aud)</label>
                        <input
                        id="jwt-verify-audience"
                        type="text"
                        className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm"
                        placeholder="Optional"
                        value={audience}
                        onChange={(e) => setAudience(e.target.value)}
                        />
                    </div>

                    <div>
                        <label htmlFor="jwt-verify-issuer" className="block text-sm font-medium text-slate-700 mb-1">Expected Issuer (iss)</label>
                        <input
                        id="jwt-verify-issuer"
                        type="text"
                        className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm"
                        placeholder="Optional"
                        value={issuer}
                        onChange={(e) => setIssuer(e.target.value)}
                        />
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <button
                        onClick={handleVerify}
                        disabled={!token}
                        className="inline-flex justify-center py-2.5 px-4 border border-transparent shadow-sm text-sm font-bold rounded-lg text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors"
                    >
                        Verify Token
                    </button>

                    <button
                        onClick={() => {
                            setToken('');
                            setDecoded(null);
                            setKey('your-256-bit-secret');
                            setAudience('');
                            setIssuer('');
                            setVerification(null);
                        }}
                        className="inline-flex justify-center items-center gap-2 py-2.5 px-4 border border-slate-300 shadow-sm text-sm font-bold rounded-lg text-slate-600 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors"
                    >
                        <RefreshIcon className="h-4 w-4" />
                        Reset to Defaults
                    </button>
                </div>

                {token && (
                    <button
                        onClick={() => {
                            storageService.saveItem({
                                type: 'jwt',
                                title: `JWT - ${decoded?.payload?.sub || 'Untitled'}`,
                                content: token,
                                metadata: {
                                    iss: decoded?.payload?.iss,
                                    exp: decoded?.payload?.exp,
                                    alg: decoded?.header?.alg
                                }
                            });
                            alert('JWT saved to collection!');
                        }}
                        className="w-full inline-flex justify-center items-center gap-2 py-2.5 px-4 border border-slate-300 shadow-sm text-sm font-bold rounded-lg text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors"
                    >
                        <SaveIcon className="h-4 w-4" />
                        Save to Collection
                    </button>
                )}
            </div>
             {renderVerificationStatus()}
        </div>
      </div>
      
      <div className="space-y-6">
         <div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">Decoded Payload</h3>
            <p className="text-slate-600">Data extracted from the token.</p>
        </div>
        {decoded ? (
          <div className="space-y-4 animate-fade-in">
            <div className="bg-slate-800 rounded-xl shadow-lg border border-slate-700">
                <div className="px-4 py-2 bg-slate-900 border-b border-slate-700 flex justify-between items-center rounded-t-xl">
                    <span className="text-xs font-bold text-slate-400 uppercase">Header</span>
                    <span className="text-xs font-mono text-slate-500">ALGORITHM & TOKEN TYPE</span>
                </div>
                <JsonViewer data={decoded.header} />
            </div>
            
            <div className="bg-slate-800 rounded-xl shadow-lg border border-slate-700">
                 <div className="px-4 py-2 bg-slate-900 border-b border-slate-700 flex justify-between items-center rounded-t-xl">
                    <span className="text-xs font-bold text-slate-400 uppercase">Payload</span>
                    <span className="text-xs font-mono text-slate-500">DATA</span>
                </div>
                <JsonViewer data={decoded.payload} />
            </div>
            
             <div className="bg-slate-800 rounded-xl shadow-lg border border-slate-700">
                <div className="px-4 py-2 bg-slate-900 border-b border-slate-700 flex justify-between items-center rounded-t-xl">
                    <span className="text-xs font-bold text-slate-400 uppercase">Signature</span>
                    <span className="text-xs font-mono text-slate-500">VERIFICATION</span>
                </div>
                <div className="p-4">
                     <code className="text-sm text-emerald-400 font-mono break-all whitespace-pre-wrap">{decoded.signature}</code>
                </div>
            </div>
          </div>
        ) : (
          <div className="h-96 flex flex-col items-center justify-center bg-slate-100 rounded-xl border-2 border-dashed border-slate-300">
             <div className="animate-pulse flex flex-col items-center">
                <div className="h-12 w-12 bg-slate-200 rounded-full mb-4"></div>
                <div className="h-4 w-48 bg-slate-200 rounded mb-2"></div>
                <div className="h-3 w-32 bg-slate-200 rounded"></div>
             </div>
             <p className="text-slate-400 font-medium mt-6">Waiting for input...</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default JwtDecoder;