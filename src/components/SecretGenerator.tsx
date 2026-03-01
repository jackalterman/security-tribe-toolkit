import React, { useState, useEffect } from 'react';
import CodeBlock from './CodeBlock';
import { KeyIcon, RefreshIcon } from './icons';

const SecretGenerator: React.FC = () => {
  const [length, setLength] = useState(32);
  const [type, setType] = useState<'hex' | 'base64' | 'base64url' | 'password' | 'credentials'>('hex');
  const [secret, setSecret] = useState('');
  const [clientId, setClientId] = useState('');

  const generate = () => {
      const arr = new Uint8Array(length);
      crypto.getRandomValues(arr);
      
      if (type === 'hex') {
          setSecret(Array.from(arr, b => b.toString(16).padStart(2, '0')).join(''));
      } else if (type === 'base64') {
          const binary = Array.from(arr, b => String.fromCharCode(b)).join('');
          setSecret(btoa(binary));
      } else if (type === 'base64url') {
          const binary = Array.from(arr, b => String.fromCharCode(b)).join('');
          setSecret(btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
      } else if (type === 'credentials') {
          setClientId(crypto.randomUUID());
          setSecret(Array.from(arr, b => b.toString(16).padStart(2, '0')).join(''));
      } else {
          // Password-like (simplified)
          const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+";
          let res = '';
          for(let i=0; i<length; i++) {
              res += chars[Math.floor(Math.random() * chars.length)];
          }
          setSecret(res);
      }
  };

  useEffect(() => {
      generate();
  }, [length, type]);

  return (
    <div className="w-full">
         <div className="mb-6">
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Secret Generator</h2>
            <p className="text-slate-600">Generate cryptographically secure random strings for API Keys, Client Secrets, or Salts.</p>
         </div>

         <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
             <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-end gap-6">
                 <div className="flex-1 min-w-[300px]">
                     <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Format</label>
                     <div className="flex bg-slate-100 p-1.5 rounded-xl overflow-x-auto no-scrollbar">
                         {['hex', 'base64', 'base64url', 'password', 'credentials'].map(t => (
                             <button
                                key={t}
                                onClick={() => setType(t as any)}
                                className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
                                    type === t 
                                    ? 'bg-white text-sky-600 shadow-sm scale-[1.02]' 
                                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
                                }`}
                             >
                                 {t === 'credentials' ? 'OIDC Credentials' : t.charAt(0).toUpperCase() + t.slice(1)}
                             </button>
                         ))}
                     </div>
                 </div>
                 <div className="flex gap-6 items-end">
                    <div className="w-32">
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-3">Length (Bytes)</label>
                        <input 
                            type="number" 
                            min="8" max="128" 
                            value={length} 
                            onChange={(e) => setLength(parseInt(e.target.value))}
                            className="block w-full rounded-lg border-slate-300 shadow-sm focus:border-sky-500 focus:ring-sky-500 text-sm py-2.5 font-mono" 
                        />
                    </div>
                    <button 
                        onClick={generate} 
                        className="px-6 py-2.5 bg-slate-800 text-white rounded-lg hover:bg-slate-900 flex items-center gap-2 text-sm font-bold shadow-sm transition-all hover:shadow-md active:scale-95 whitespace-nowrap"
                    >
                        <RefreshIcon className="h-4 w-4" /> Generate
                    </button>
                 </div>
             </div>
             
              <div className="p-8 bg-slate-50 space-y-6">
                {type === 'credentials' ? (
                    <>
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Client ID (UUID)</label>
                            <CodeBlock content={clientId} />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Client Secret</label>
                            <CodeBlock content={secret} />
                        </div>
                    </>
                ) : (
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Result</label>
                        <CodeBlock content={secret} />
                    </div>
                )}
              </div>
         </div>
    </div>
  );
};

export default SecretGenerator;
