
import React, { useState, useEffect } from 'react';
import CodeBlock from './CodeBlock';
import { jwtService } from '../services/jwtService';
import { storageService } from '../services/storageService';
import { getJwtEncoderState, saveJwtEncoderState, JwtEncoderState } from '../services/jwtStorage';
import { SendIcon, KeyIcon, SaveIcon, RefreshIcon, DownloadIcon, ShieldCheckIcon, CertificateIcon, TrashIcon, XIcon, PlusIcon, LockClosedIcon, ChevronDownIcon, FileCodeIcon, DatabaseIcon } from './icons';
import { keyParsingService, ParsedKeyResult } from '../services/keyParsingService';
import type { DecoderData } from '../types';

interface JwtEncoderProps {
  onSendToDecoder: (data: DecoderData) => void;
}

const defaultPayload = {
  sub: '1234567890',
  name: 'John Doe',
  admin: true,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const JwtEncoder: React.FC<JwtEncoderProps> = ({ onSendToDecoder }) => {
  const [alg, setAlg] = useState('HS256');
  const [header, setHeader] = useState(JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2));
  const [payload, setPayload] = useState(JSON.stringify(defaultPayload, null, 2));
  const [secret, setSecret] = useState('your-256-bit-secret');
  const [privateKey, setPrivateKey] = useState('');
  const [publicKey, setPublicKey] = useState('');
  const [generatedToken, setGeneratedToken] = useState('');
  const [error, setError] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [password, setPassword] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const [showUploadDropdown, setShowUploadDropdown] = useState(false);
  const [collections, setCollections] = useState<any[]>([]);

  // Load state from IndexedDB
  useEffect(() => {
    const loadState = async () => {
      try {
        const savedState = await getJwtEncoderState();
        if (savedState) {
          setAlg(savedState.alg);
          setHeader(savedState.header);
          setPayload(savedState.payload);
          setSecret(savedState.secret);
          setPrivateKey(savedState.privateKey);
        }
      } catch (err) {
        console.error('Failed to load encoder state', err);
      } finally {
        setIsLoaded(true);
      }
    };
    loadState();
  }, []);

  // Load collections when picker is opened
  useEffect(() => {
    if (showCollectionPicker) {
      const loadCollections = async () => {
        try {
          const items = await storageService.getItems();
          setCollections(items);
        } catch (err) {
          console.error('Failed to load collections', err);
        }
      };
      loadCollections();
    }
  }, [showCollectionPicker]);

  // Save state to IndexedDB
  useEffect(() => {
    if (!isLoaded) return;
    const state: JwtEncoderState = { alg, header, payload, secret, privateKey };
    saveJwtEncoderState(state).catch(err => console.error('Failed to save encoder state', err));
  }, [isLoaded, alg, header, payload, secret, privateKey]);

  useEffect(() => {
    if (!isLoaded) return;
    try {
      const headerObj = JSON.parse(header);
      if (headerObj.alg !== alg) {
        headerObj.alg = alg;
        setHeader(JSON.stringify(headerObj, null, 2));
      }
    } catch (e) {
      // Ignore parsing errors while typing
    }
  }, [alg, isLoaded]);

  const handleGenerateKeys = async () => {
    let keys;
    if (alg === 'RS256') {
        keys = await jwtService.generateRsaKeyPair();
    } else {
        keys = await jwtService.generateEcKeyPair();
    }
    setPrivateKey(keys.privateKey);
    setPublicKey(keys.publicKey);
  };

  const handleGenerate = async () => {
    setError('');
    setGeneratedToken('');
    try {
      const headerObj = JSON.parse(header);
      const payloadObj = JSON.parse(payload);
      const key = alg === 'HS256' ? secret : privateKey;
      if (!key) {
        setError(alg === 'HS256' ? 'Secret cannot be empty.' : 'Private key cannot be empty.');
        return;
      }
      const token = await jwtService.sign(headerObj, payloadObj, key);
      setGeneratedToken(token);
      localStorage.setItem('SecurityTribeToolkit_encoded_jwt', token);
    } catch (e: any) {
      setError(`Failed to generate token: ${e.message}`);
      console.error(e);
    }
  };

  const handleSend = () => {
    if (generatedToken) {
        onSendToDecoder({
            token: generatedToken,
            key: alg === 'HS256' ? secret : publicKey,
        });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith('.p12') || file.name.toLowerCase().endsWith('.pfx')) {
        setPendingFile(file);
        setShowPasswordModal(true);
    } else {
        try {
            const result = await keyParsingService.parseFile(file);
            applyParsingResult(result);
        } catch (err: any) {
            setError(err.message);
        }
    }
    // Clear input
    e.target.value = '';
  };

  const handlePasswordSubmit = async () => {
    if (!pendingFile) return;
    try {
        const result = await keyParsingService.parseFile(pendingFile, password);
        applyParsingResult(result);
        setShowPasswordModal(false);
        setPassword('');
        setPendingFile(null);
    } catch (err: any) {
        setError(`Decryption failed: ${err.message}`);
    }
  };

  const applyParsingResult = (result: ParsedKeyResult) => {
    if (result.privateKey) {
        setPrivateKey(result.privateKey);
        setShowSecret(true);
    }
    if (result.publicKey) setPublicKey(result.publicKey);
    setSuccessMessage(`Loaded ${result.format} ${result.type}`);
    setTimeout(() => setSuccessMessage(''), 3000);
  };

  const handleCollectionItemSelect = (item: any) => {
    if (item.type === 'key') {
        setPrivateKey(item.content);
        setShowSecret(true);
        // Auto-derive public key if possible
        if (alg !== 'HS256') {
            const derivedPublic = keyParsingService.derivePublicKey(item.content);
            if (derivedPublic) setPublicKey(derivedPublic);
        }
    } else if (item.type === 'certificate') {
        setPublicKey(item.content);
    } else if (item.type === 'jwt') {
        if (alg === 'HS256') {
            setSecret(item.content);
            setShowSecret(true);
        } else {
            setPrivateKey(item.content);
            setShowSecret(true);
            // Auto-derive public key if possible
            const derivedPublic = keyParsingService.derivePublicKey(item.content);
            if (derivedPublic) setPublicKey(derivedPublic);
        }
    }
    setSuccessMessage(`Loaded from collection: ${item.title}`);
    setTimeout(() => setSuccessMessage(''), 3000);
    setShowCollectionPicker(false);
  };

  const handleSaveToCollection = async (type: 'jwt' | 'key' | 'certificate') => {
    try {
        let content = '';
        let title = '';
        
        if (type === 'jwt') {
            content = generatedToken;
            title = `JWT - ${JSON.parse(payload).sub || 'Untitled'}`;
        } else if (type === 'key') {
            content = privateKey;
            title = `Private Key - ${alg}`;
        } else if (type === 'certificate') {
            content = publicKey;
            title = `Public Key/Cert - ${alg}`;
        }

        await storageService.saveItem({
            type,
            title,
            content,
            metadata: {
                alg,
                generatedAt: new Date().toISOString()
            }
        });
        setSuccessMessage(`${type} saved to collection!`);
        setTimeout(() => setSuccessMessage(''), 3000);
    } catch (e: any) {
        setError(`Failed to save: ${e.message}`);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <div className="space-y-6">
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-2">JWT Encoder</h2>
            <p className="text-slate-600">Create a new JWT by defining its algorithm, header, payload, and signing key.</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-5">
          <div>
            <label htmlFor="jwt-alg" className="block text-sm font-semibold text-slate-700 mb-1">Algorithm</label>
            <select
              id="jwt-alg"
              className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 sm:text-sm py-2.5"
              value={alg}
              onChange={(e) => setAlg(e.target.value)}
            >
              <option value="HS256">HS256 (Symmetric - HMAC SHA256)</option>
              <option value="RS256">RS256 (Asymmetric - RSA SHA256)</option>
              <option value="ES256">ES256 (Asymmetric - ECDSA P-256)</option>
            </select>
          </div>
          
          <div className="grid grid-cols-1 gap-5">
             <div>
                <div className="flex justify-between items-baseline mb-1">
                    <label htmlFor="jwt-header" className="block text-sm font-semibold text-slate-700">Header JSON</label>
                    <button 
                        onClick={() => setHeader(JSON.stringify({ alg: alg, typ: 'JWT' }, null, 2))}
                        className="text-[10px] text-slate-500 hover:text-sky-600 font-bold uppercase tracking-tight flex items-center gap-1"
                    >
                        <RefreshIcon className="h-3 w-3" /> Reset
                    </button>
                </div>
                <textarea
                id="jwt-header"
                rows={4}
                className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm font-mono bg-slate-50"
                value={header}
                onChange={(e) => setHeader(e.target.value)}
                />
            </div>

            <div>
                <div className="flex justify-between items-baseline mb-1">
                    <label htmlFor="jwt-payload" className="block text-sm font-semibold text-slate-700">Payload JSON</label>
                    <button 
                        onClick={() => setPayload(JSON.stringify(defaultPayload, null, 2))}
                        className="text-[10px] text-slate-500 hover:text-sky-600 font-bold uppercase tracking-tight flex items-center gap-1"
                    >
                        <RefreshIcon className="h-3 w-3" /> Reset
                    </button>
                </div>
                <textarea
                id="jwt-payload"
                rows={8}
                className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm font-mono bg-slate-50"
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100">
            {alg === 'HS256' ? (
                <div>
                <div className="flex justify-between items-center mb-1">
                    <label htmlFor="jwt-secret" className="block text-sm font-semibold text-slate-700">HMAC Secret</label>
                    <button 
                        onClick={() => setShowSecret(!showSecret)}
                        className="text-xs text-sky-600 hover:text-sky-700 font-medium"
                    >
                        {showSecret ? 'Hide' : 'Show'}
                    </button>
                </div>
                <input
                    id="jwt-secret"
                    type={showSecret ? "text" : "password"}
                    className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm font-mono"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                />
                </div>
            ) : (
                <div className="space-y-4">
                <div className="flex gap-2">
                    <button
                        onClick={handleGenerateKeys}
                        className="flex-1 inline-flex justify-center items-center gap-2 py-2.5 px-4 border border-slate-300 shadow-sm text-sm font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 transition-colors"
                    >
                        <KeyIcon className="h-4 w-4 text-sky-500" /> New Keys
                    </button>
                    
                    <div className="flex-1 relative">
                        <button
                            onClick={() => setShowUploadDropdown(!showUploadDropdown)}
                            className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 border shadow-sm text-sm font-medium rounded-lg transition-all ${
                                showUploadDropdown 
                                ? 'bg-sky-50 border-sky-200 text-sky-700' 
                                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                            }`}
                        >
                            <DownloadIcon className="h-4 w-4 text-sky-500" />
                            <span>Upload Key</span>
                            <ChevronDownIcon className={`h-4 w-4 text-slate-400 transition-transform ${showUploadDropdown ? 'rotate-180' : ''}`} />
                        </button>

                        {showUploadDropdown && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setShowUploadDropdown(false)} />
                                <div className="absolute top-full right-0 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in py-1 min-w-[180px]">
                                    <label className="w-full flex items-center px-4 py-2 text-left text-xs text-slate-600 hover:bg-sky-50 transition-colors cursor-pointer">
                                        <DownloadIcon className="h-4 w-4 mr-2 text-sky-500" />
                                        Upload File
                                        <input type="file" className="hidden" onChange={(e) => { handleFileUpload(e); setShowUploadDropdown(false); }} />
                                    </label>
                                    <button
                                        onClick={() => {
                                            setShowCollectionPicker(true);
                                            setShowUploadDropdown(false);
                                        }}
                                        className="w-full flex items-center px-4 py-2 text-left text-xs text-slate-600 hover:bg-sky-50 transition-colors border-t border-slate-50"
                                    >
                                        <DatabaseIcon className="h-4 w-4 mr-2 text-sky-500" />
                                        Load from Collection
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {successMessage && (
                    <div className="p-2 bg-green-50 border border-green-200 text-green-700 text-xs rounded-lg animate-fade-in flex items-center justify-center">
                        <ShieldCheckIcon className="h-3 w-3 mr-1" /> {successMessage}
                    </div>
                )}

                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label htmlFor="jwt-private-key" className="block text-sm font-semibold text-slate-700">Private Key (PEM)</label>
                         <div className="flex items-center gap-3">
                            <button 
                                onClick={() => handleSaveToCollection('key')}
                                className="text-[10px] text-slate-500 hover:text-sky-600 font-bold uppercase tracking-tight flex items-center gap-1"
                                disabled={!privateKey}
                            >
                                <SaveIcon className="h-3 w-3" /> Save to Coll.
                            </button>
                            <button 
                                onClick={() => setShowSecret(!showSecret)}
                                className="text-xs text-sky-600 hover:text-sky-700 font-medium"
                            >
                                {showSecret ? 'Hide' : 'Show'}
                            </button>
                        </div>
                    </div>
                    <textarea
                    id="jwt-private-key"
                    rows={6}
                    className={`block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-xs font-mono bg-slate-50 ${!showSecret ? 'text-transparent tracking-tighter select-none' : ''}`}
                    value={privateKey}
                    placeholder="Paste your PEM private key here or generate one."
                    onChange={(e) => setPrivateKey(e.target.value)}
                    style={{ textShadow: !showSecret ? '0 0 8px rgba(0,0,0,0.5)' : 'none' }}
                    />
                </div>
                <div>
                    <div className="flex justify-between items-center mb-1">
                        <label htmlFor="jwt-public-key" className="block text-sm font-semibold text-slate-700">Public Key (PEM)</label>
                         <button 
                            onClick={() => handleSaveToCollection('certificate')}
                            className="text-[10px] text-slate-500 hover:text-sky-600 font-bold uppercase tracking-tight flex items-center gap-1"
                            disabled={!publicKey}
                        >
                            <SaveIcon className="h-3 w-3" /> Save to Coll.
                        </button>
                    </div>
                    <textarea
                    id="jwt-public-key"
                    rows={4}
                    readOnly
                    className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-xs font-mono bg-slate-100 text-slate-500"
                    value={publicKey}
                    placeholder="(Generated automatically)"
                    />
                </div>
                </div>
            )}
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={handleGenerate}
              className="inline-flex justify-center py-3 px-4 border border-transparent shadow-sm text-sm font-bold rounded-lg text-white bg-sky-600 hover:bg-sky-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors"
            >
              Generate Token
            </button>
            <button
              onClick={() => {
                setAlg('HS256');
                setHeader(JSON.stringify({ alg: 'HS256', typ: 'JWT' }, null, 2));
                setPayload(JSON.stringify(defaultPayload, null, 2));
                setSecret('your-256-bit-secret');
                setPrivateKey('');
                setGeneratedToken('');
                setError('');
              }}
              className="inline-flex justify-center items-center gap-2 py-3 px-4 border border-slate-300 shadow-sm text-sm font-bold rounded-lg text-slate-600 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors"
            >
              <RefreshIcon className="h-4 w-4" />
              Reset to Defaults
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        <div>
             <h3 className="text-lg font-bold text-slate-900 mb-2">Output</h3>
             <p className="text-slate-600">The generated token will appear here.</p>
        </div>
       
        {error && (
             <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded-r-lg">
                <p className="text-sm text-red-700 font-medium">{error}</p>
             </div>
        )}
        
        {generatedToken ? (
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 animate-fade-in">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Encoded Token</label>
                <CodeBlock content={generatedToken} variant="output" />
                <div className="mt-6 p-4 bg-sky-50 rounded-lg border border-sky-100">
                    <h4 className="text-sm font-bold text-sky-900 mb-2">Next Step</h4>
                    <p className="text-sm text-sky-700 mb-4">
                        Copy this token or send it directly to the Decoder to verify the signature and inspect claims.
                    </p>
                    <button
                        onClick={handleSend}
                        className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 mb-3 border border-transparent shadow-sm text-sm font-medium rounded-lg text-white bg-slate-800 hover:bg-slate-900 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 transition-colors"
                    >
                        <SendIcon className="h-5 w-5" />
                        Send to Decoder
                    </button>
                    <button
                        onClick={async () => {
                            await storageService.saveItem({
                                type: 'jwt',
                                title: `JWT - ${JSON.parse(payload).sub || 'Untitled'}`,
                                content: generatedToken,
                                metadata: {
                                    iss: JSON.parse(payload).iss,
                                    alg: JSON.parse(header).alg
                                }
                            });
                        }}
                        className="w-full inline-flex items-center justify-center gap-2 py-2.5 px-4 border border-slate-300 shadow-sm text-sm font-bold rounded-lg text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-sky-500 transition-colors"
                    >
                        <SaveIcon className="h-4 w-4" />
                        Save to Collection
                    </button>
                </div>
            </div>
        ) : (
          <div className="h-64 flex flex-col items-center justify-center bg-slate-100 rounded-xl border-2 border-dashed border-slate-300">
            <KeyIcon className="h-12 w-12 text-slate-300 mb-3" />
            <p className="text-slate-500 font-medium">Ready to generate</p>
          </div>
        )}
      </div>
      {/* Password Modal */}
      {showPasswordModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in border border-slate-200">
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                    <h3 className="font-bold text-slate-800">Keystore Password</h3>
                    <button onClick={() => setShowPasswordModal(false)} className="p-1 hover:bg-slate-200 rounded-lg transition-colors">
                        <XIcon className="h-5 w-5 text-slate-500" />
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div className="flex items-center gap-3 p-3 bg-blue-50 text-blue-800 rounded-xl text-xs border border-blue-100">
                        <LockClosedIcon className="h-5 w-5 text-blue-500 shrink-0" />
                        <p>This PKCS#12 file is encrypted. Enter the password to decrypt it locally.</p>
                    </div>
                    <input 
                        type="password"
                        placeholder="Password"
                        className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-sky-500 outline-none"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                        autoFocus
                    />
                    <div className="flex gap-3">
                        <button 
                            onClick={() => setShowPasswordModal(false)}
                            className="flex-1 py-2 px-4 border border-slate-200 text-slate-600 font-bold rounded-lg hover:bg-slate-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={handlePasswordSubmit}
                            className="flex-1 py-2 px-4 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 transition-colors shadow-sm"
                        >
                            Decrypt
                        </button>
                    </div>
                </div>
            </div>
        </div>
      )}

      {/* Collection Picker Modal */}
      {showCollectionPicker && (
          <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in border border-slate-200">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <DatabaseIcon className="h-5 w-5 text-sky-600" />
                        <h3 className="font-bold text-slate-800">Load from Collection</h3>
                      </div>
                      <button onClick={() => setShowCollectionPicker(false)} className="p-1 hover:bg-slate-200 rounded-lg transition-colors">
                          <XIcon className="h-5 w-5 text-slate-500" />
                      </button>
                  </div>
                  <div className="max-h-[400px] overflow-y-auto p-2 custom-scrollbar pr-1">
                      {collections.length === 0 ? (
                          <div className="p-8 text-center text-slate-400 italic">No items found in collections.</div>
                      ) : (
                          collections.map(s => (
                              <button 
                                key={s.id}
                                onClick={() => handleCollectionItemSelect(s)}
                                className="w-full text-left p-3 hover:bg-sky-50 rounded-xl transition-colors flex items-center group mb-1 border border-transparent hover:border-sky-100"
                              >
                                  <div className="bg-sky-100 p-2 rounded-lg mr-3 group-hover:bg-sky-200 transition-colors">
                                      {s.type === 'key' ? <KeyIcon className="h-4 w-4 text-sky-600" /> :
                                       s.type === 'jwt' ? <FileCodeIcon className="h-4 w-4 text-sky-600" /> :
                                       s.type === 'certificate' ? <CertificateIcon className="h-4 w-4 text-sky-600" /> :
                                       <DatabaseIcon className="h-4 w-4 text-sky-600" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between">
                                        <div className="font-semibold text-sm text-slate-700 truncate">{s.title}</div>
                                        <span className="text-[9px] font-bold text-sky-500 uppercase px-1.5 py-0.5 bg-sky-50 rounded border border-sky-100">{s.type}</span>
                                      </div>
                                      <div className="text-[10px] text-slate-400 font-mono truncate">{s.content}</div>
                                  </div>
                              </button>
                          ))
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default JwtEncoder;
