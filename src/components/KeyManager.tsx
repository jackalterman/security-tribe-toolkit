import React, { useState, useEffect } from 'react';
import CodeBlock from './CodeBlock';
import { jwtService } from '../services/jwtService';
import { KeyIcon, CertificateIcon, ClipboardIcon, CheckIcon, ShieldCheckIcon, AlertTriangleIcon, RefreshIcon, DownloadIcon } from './icons';
import { KeyPair, DecoderData } from '../types';
import CertificateAnalyzer from './CertificateAnalyzer';
import ExportModal from './ExportModal';

interface KeyManagerProps {
  onSendToDecoder?: (data: DecoderData) => void;
}

const KeyManager: React.FC<KeyManagerProps> = ({ onSendToDecoder }) => {
  const [keyPair, setKeyPair] = useState<KeyPair | null>(null);
  const [activeTab, setActiveTab] = useState<'pem' | 'jwks' | 'cert' | 'registration'>('pem');
  const [showPrivate, setShowPrivate] = useState(false);
  const [algType, setAlgType] = useState<'RSA' | 'EC'>('RSA');
  const [keySize, setKeySize] = useState<number>(2048);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportSource, setExportSource] = useState<'pem' | 'jwks' | 'cert'>('pem');

  useEffect(() => {
    generateKeys();
    generateCredentials();
  }, []);

  const generateKeys = async () => {
    setIsGenerating(true);
    try {
        let keys;
        if (algType === 'RSA') {
             keys = await jwtService.generateRsaKeyPair(keySize);
        } else {
             keys = await jwtService.generateEcKeyPair();
        }
        setKeyPair(keys);
        setShowPrivate(false);
    } catch (e) {
        console.error(e);
    } finally {
        setIsGenerating(false);
    }
  };

  const generateCredentials = () => {
      setClientId(crypto.randomUUID());
      const array = new Uint8Array(32);
      crypto.getRandomValues(array);
      setClientSecret(Array.from(array, byte => byte.toString(16).padStart(2, '0')).join(''));
  };

  const getSimulatedCert = () => {
      if (!keyPair) return '';
      const body = keyPair.publicKey
        .replace('-----BEGIN PUBLIC KEY-----', '')
        .replace('-----END PUBLIC KEY-----', '')
        .trim();
      
      return `-----BEGIN CERTIFICATE-----
MIIDXTCCAkWgAwIBAgIJAL... (Simulated Header) ...
${body}
... (Simulated Footer & Signature) ...
-----END CERTIFICATE-----`;
  };

  const handleCopy = (text: string) => {
      navigator.clipboard.writeText(text);
  };

  const CopyButton = ({ text, disabled }: { text: string, disabled?: boolean }) => {
      const [copied, setCopied] = useState(false);
      
      const onClick = () => {
          if (disabled) return;
          navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
      }

      return (
          <button 
            onClick={onClick}
            disabled={disabled}
            className={`flex items-center space-x-1 px-3 py-1 rounded-md text-xs font-medium transition-all border ${
                disabled 
                ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed' 
                : copied 
                    ? 'bg-green-50 border-green-200 text-green-700' 
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
            }`}
          >
            {copied ? <CheckIcon className="w-3 h-3" /> : <ClipboardIcon className="w-3 h-3" />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
      );
  }

  const ExportButton = ({ onClick, disabled }: { onClick: () => void, disabled?: boolean }) => {
    return (
        <button 
          onClick={onClick}
          disabled={disabled}
          className={`flex items-center space-x-1 px-3 py-1 rounded-md text-xs font-medium transition-all border ${
              disabled 
              ? 'bg-slate-50 border-slate-200 text-slate-300 cursor-not-allowed' 
              : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'
          }`}
          title="Export to file"
        >
          <DownloadIcon className="w-3 h-3" />
          <span>Export</span>
        </button>
    );
  }

  const handleExportClick = (source: 'pem' | 'jwks' | 'cert') => {
      setExportSource(source);
      setIsExportModalOpen(true);
  };

  const handleExportConfirm = (format: 'p12' | 'jwks' | 'pem', options: { password?: string; alias?: string }) => {
      if (!keyPair) return;

      try {
          if (format === 'pem') {
              const content = exportSource === 'jwks' 
                  ? JSON.stringify(keyPair.jwks, null, 2) 
                  : (exportSource === 'pem' ? (showPrivate ? keyPair.privateKey : keyPair.publicKey) : '');
              
              const filename = exportSource === 'jwks' ? 'keys.jwks.json' : (showPrivate ? 'private-key.pem' : 'public-key.pem');
              jwtService.downloadFile(content, filename, exportSource === 'jwks' ? 'application/json' : 'application/x-pem-file');
          } else if (format === 'jwks') {
              jwtService.downloadFile(JSON.stringify(keyPair.jwks, null, 2), 'keys.jwks.json', 'application/json');
          } else if (format === 'p12') {
              const p12 = jwtService.exportToPkcs12(
                  keyPair.privateKey, 
                  null, // No certificate for now, it will self-sign
                  options.password || '', 
                  options.alias || 'my-key'
              );
              jwtService.downloadFile(p12, `${options.alias || 'key'}.p12`, 'application/x-pkcs12');
          }
      } catch (e: any) {
          alert(`Export failed: ${e.message}`);
      }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-fade-in">
      <div className="lg:col-span-1 space-y-6">
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Key Manager</h2>
            <p className="text-slate-600">Generate and manage cryptographic keys, certificates, and application credentials.</p>
        </div>

        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-5">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                    <KeyIcon className="h-5 w-5 text-sky-600" />
                    Key Configuration
                </h3>
            </div>
            
            <div className="space-y-4">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Algorithm</label>
                    <select 
                        value={algType}
                        onChange={(e) => {
                            setAlgType(e.target.value as 'RSA' | 'EC');
                            setKeySize(e.target.value === 'RSA' ? 2048 : 256);
                        }}
                        className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm py-2.5"
                    >
                        <option value="RSA">RSA (RS256)</option>
                        <option value="EC">Elliptic Curve (ES256)</option>
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Key Size / Curve</label>
                    <select 
                        value={keySize}
                        onChange={(e) => setKeySize(Number(e.target.value))}
                        disabled={algType === 'EC'}
                        className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm py-2.5 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                         {algType === 'RSA' ? (
                            <>
                                <option value={2048}>2048 bits (Standard)</option>
                                <option value={4096}>4096 bits (High Security)</option>
                            </>
                        ) : (
                            <option value={256}>P-256 (Prime256v1)</option>
                        )}
                    </select>
                </div>
            </div>

            <button
                onClick={generateKeys}
                disabled={isGenerating}
                className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 border border-transparent shadow-sm text-sm font-bold rounded-lg text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors ${isGenerating ? 'opacity-75 cursor-wait' : ''}`}
            >
                {isGenerating ? (
                    'Generating...'
                ) : (
                    <>
                        <RefreshIcon className="h-4 w-4" />
                        Rotate Key Pair
                    </>
                )}
            </button>
            
            <div className="border-t border-slate-100 pt-4">
                <button
                    onClick={generateCredentials}
                    className="w-full py-2.5 px-4 border border-slate-300 shadow-sm text-sm font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                >
                    Regenerate App Secrets
                </button>
            </div>
        </div>

        <div className="bg-indigo-50 p-5 rounded-xl border border-indigo-100 text-sm text-indigo-900">
            <h4 className="font-bold mb-2 flex items-center gap-2">
                <ShieldCheckIcon className="h-4 w-4" />
                Security Note
            </h4>
            <p className="mb-2 leading-relaxed opacity-90">
                <strong>Private Keys</strong> never leave your browser. They are generated using the Web Crypto API.
            </p>
            <p className="leading-relaxed opacity-90">
                For real applications, never generate keys in a browser-based tool. Use OpenSSL or a secure Key Management Service (KMS).
            </p>
        </div>
      </div>

      <div className="lg:col-span-2">
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[600px] flex flex-col">
            <div className="flex border-b border-slate-200 overflow-x-auto">
                <button onClick={() => setActiveTab('pem')} className={`flex-1 py-3 px-4 whitespace-nowrap text-sm font-bold border-b-2 transition-colors ${activeTab === 'pem' ? 'border-sky-600 text-sky-600 bg-slate-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>PEM Keys</button>
                <button onClick={() => setActiveTab('jwks')} className={`flex-1 py-3 px-4 whitespace-nowrap text-sm font-bold border-b-2 transition-colors ${activeTab === 'jwks' ? 'border-sky-600 text-sky-600 bg-slate-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>JWKS</button>
                <button onClick={() => setActiveTab('cert')} className={`flex-1 py-3 px-4 whitespace-nowrap text-sm font-bold border-b-2 transition-colors ${activeTab === 'cert' ? 'border-sky-600 text-sky-600 bg-slate-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>Certificate</button>
                <button onClick={() => setActiveTab('registration')} className={`flex-1 py-3 px-4 whitespace-nowrap text-sm font-bold border-b-2 transition-colors ${activeTab === 'registration' ? 'border-sky-600 text-sky-600 bg-slate-50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}>App Credentials</button>
            </div>
            
            <div className="p-6 flex-1 bg-slate-50 overflow-y-auto">
                {keyPair && activeTab === 'pem' && (
                    <div className="space-y-8 animate-fade-in">
                        
                        {/* Public Key */}
                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="bg-white px-4 py-3 border-b border-slate-100 flex justify-between items-center">
                                <div className="flex items-center gap-2.5">
                                    <div className="p-1.5 bg-green-100 rounded-lg">
                                        <ShieldCheckIcon className="h-5 w-5 text-green-600" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-900">Public Key</h4>
                                        <p className="text-xs text-slate-500">Shareable • {algType}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <ExportButton onClick={() => handleExportClick('pem')} />
                                    <CopyButton text={keyPair.publicKey} />
                                </div>
                            </div>
                            <div className="p-4 bg-slate-900">
                                <CodeBlock content={keyPair.publicKey} />
                            </div>
                        </div>

                        {/* Private Key */}
                        <div className="bg-white rounded-xl border border-amber-200 shadow-sm overflow-hidden ring-1 ring-amber-100">
                            <div className="bg-amber-50/50 px-4 py-3 border-b border-amber-100 flex justify-between items-center">
                                <div className="flex items-center gap-2.5">
                                    <div className="p-1.5 bg-amber-100 rounded-lg">
                                        <KeyIcon className="h-5 w-5 text-amber-600" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-900">Private Key</h4>
                                        <p className="text-xs text-amber-700 font-medium">DO NOT SHARE</p>
                                    </div>
                                </div>
                                <div className="flex items-center space-x-3">
                                    <ExportButton onClick={() => handleExportClick('pem')} disabled={!showPrivate} />
                                    <button 
                                        onClick={() => setShowPrivate(!showPrivate)}
                                        className="text-xs font-semibold text-slate-600 hover:text-sky-600 focus:outline-none"
                                    >
                                        {showPrivate ? 'Hide Key' : 'Reveal Key'}
                                    </button>
                                    <div className="w-px h-4 bg-slate-200"></div>
                                    <CopyButton text={keyPair.privateKey} disabled={!showPrivate} />
                                </div>
                            </div>
                            <div className="p-4 bg-slate-900 relative">
                                {showPrivate ? (
                                     <CodeBlock content={keyPair.privateKey} />
                                ) : (
                                    <div className="relative py-8 select-none">
                                        <div className="font-mono text-xs text-slate-700 filter blur-md opacity-50 pointer-events-none">
                                            -----BEGIN PRIVATE KEY-----<br/>
                                            MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQPC...<br/>
                                            (Content Hidden)<br/>
                                            ...q8dJ9f<br/>
                                            -----END PRIVATE KEY-----
                                        </div>
                                        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
                                            <div className="bg-slate-800 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 text-sm font-medium mb-2 border border-slate-600">
                                                <KeyIcon className="w-4 h-4 text-amber-400" />
                                                <span>Key Masked for Security</span>
                                            </div>
                                            <p className="text-slate-400 text-xs">Click "Reveal Key" to view</p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                    </div>
                )}

                {keyPair && activeTab === 'jwks' && (
                    <div className="space-y-4 animate-fade-in">
                        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                            <div className="flex justify-between items-center mb-4">
                                <div>
                                    <h4 className="text-sm font-bold text-slate-800">JSON Web Key Set (JWKS)</h4>
                                    <p className="text-xs text-slate-500 mt-1">Standard format for exposing public keys (RFC 7517).</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <ExportButton onClick={() => handleExportClick('jwks')} />
                                    <CopyButton text={JSON.stringify(keyPair.jwks, null, 2)} />
                                </div>
                            </div>
                            <div className="bg-slate-900 rounded-lg overflow-hidden">
                                <CodeBlock content={JSON.stringify(keyPair.jwks, null, 2)} language="json" />
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'cert' && (
                     <div className="space-y-4 animate-fade-in">
                         <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
                            <p className="text-sm text-yellow-800">
                                <strong>Certificate Analysis:</strong> Paste a domain URL or a PEM chain to analyze certificate details. Use "Rotate Key Pair" in the sidebar to generate new local keys.
                            </p>
                        </div>
                        <CertificateAnalyzer onSendToDecoder={onSendToDecoder} />
                    </div>
                )}

                {activeTab === 'registration' && (
                    <div className="space-y-6 animate-fade-in">
                        <div className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm">
                            <h4 className="text-lg font-bold text-slate-800 mb-6 border-b pb-2">Application Credentials</h4>
                             <div className="space-y-6">
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Client ID</label>
                                    <div className="flex">
                                        <input readOnly value={clientId} className="flex-1 rounded-l-lg border-slate-300 bg-slate-50 text-sm font-mono text-slate-600 focus:ring-0" />
                                        <button 
                                            onClick={() => handleCopy(clientId)}
                                            className="px-4 bg-slate-100 border border-l-0 border-slate-300 rounded-r-lg text-slate-600 hover:bg-slate-200 transition-colors"
                                        >
                                            <ClipboardIcon className="h-5 w-5" />
                                        </button>
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Client Secret</label>
                                    <div className="flex group relative">
                                        <input readOnly type="password" value={clientSecret} className="flex-1 rounded-l-lg border-slate-300 bg-slate-50 text-sm font-mono text-slate-600 group-hover:text-slate-900 focus:ring-0" />
                                        <button 
                                            onClick={() => handleCopy(clientSecret)}
                                            className="px-4 bg-slate-100 border border-l-0 border-slate-300 rounded-r-lg text-slate-600 hover:bg-slate-200 transition-colors"
                                        >
                                            <ClipboardIcon className="h-5 w-5" />
                                        </button>
                                    </div>
                                    <div className="mt-4 flex items-start gap-3 text-red-700 bg-red-50 p-4 rounded-lg border border-red-100">
                                        <AlertTriangleIcon className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
                                        <div>
                                            <p className="text-sm font-bold">Security Warning</p>
                                            <p className="text-xs mt-1 opacity-90">
                                                This secret grants full access to your application. Never expose it in client-side code, GitHub, or unencrypted logs.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                             </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
      </div>

      {keyPair && (
        <ExportModal 
            isOpen={isExportModalOpen}
            onClose={() => setIsExportModalOpen(false)}
            onExport={handleExportConfirm}
            title={exportSource === 'jwks' ? 'Export JWKS' : 'Export Key Pair'}
            allowP12={exportSource === 'pem'} // Only allow P12 if we have the PEM key source
            allowJwks={exportSource === 'jwks'}
            allowPem={true}
            defaultAlias={algType === 'RSA' ? 'rsa-key' : 'ec-key'}
        />
      )}
    </div>
  );
};

export default KeyManager;
