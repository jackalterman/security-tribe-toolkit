import React, { useState } from 'react';
import { XIcon, DownloadIcon, KeyIcon, ShieldCheckIcon, AlertTriangleIcon } from './icons';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (format: 'p12' | 'jwks' | 'pem', options: { password?: string; alias?: string }) => void;
  title: string;
  allowP12?: boolean;
  allowJwks?: boolean;
  allowPem?: boolean;
  defaultAlias?: string;
}

const ExportModal: React.FC<ExportModalProps> = ({ 
  isOpen, 
  onClose, 
  onExport, 
  title, 
  allowP12 = true, 
  allowJwks = false, 
  allowPem = true,
  defaultAlias = 'private-key'
}) => {
  const [format, setFormat] = useState<'p12' | 'jwks' | 'pem'>(allowP12 ? 'p12' : (allowPem ? 'pem' : 'jwks'));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [alias, setAlias] = useState(defaultAlias);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExport = () => {
    setError(null);
    if (format === 'p12') {
      if (!password) {
        setError('Password is required for PKCS#12 export.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }
    
    onExport(format, { password, alias });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden transform transition-all animate-scale-in">
        <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <DownloadIcon className="h-5 w-5 text-sky-600" />
            {title}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <XIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Format Selection */}
          <div className="grid grid-cols-3 gap-3">
            {allowP12 && (
              <button
                onClick={() => setFormat('p12')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                  format === 'p12' ? 'border-sky-600 bg-sky-50 text-sky-700' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200'
                }`}
              >
                <div className={`p-2 rounded-lg mb-2 ${format === 'p12' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    <KeyIcon className="h-5 w-5" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider">PKCS#12</span>
                <span className="text-[10px] opacity-70">(.p12)</span>
              </button>
            )}
            {allowJwks && (
              <button
                onClick={() => setFormat('jwks')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                  format === 'jwks' ? 'border-sky-600 bg-sky-50 text-sky-700' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200'
                }`}
              >
                <div className={`p-2 rounded-lg mb-2 ${format === 'jwks' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    <ShieldCheckIcon className="h-5 w-5" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider">JWKS</span>
                <span className="text-[10px] opacity-70">(.json)</span>
              </button>
            )}
            {allowPem && (
              <button
                onClick={() => setFormat('pem')}
                className={`flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                  format === 'pem' ? 'border-sky-600 bg-sky-50 text-sky-700' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-200'
                }`}
              >
                <div className={`p-2 rounded-lg mb-2 ${format === 'pem' ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                    <DownloadIcon className="h-5 w-5" />
                </div>
                <span className="text-xs font-bold uppercase tracking-wider">PEM</span>
                <span className="text-[10px] opacity-70">(.pem)</span>
              </button>
            )}
          </div>

          {format === 'p12' && (
            <div className="space-y-4 animate-fade-in">
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Key Alias</label>
                <input
                  type="text"
                  value={alias}
                  onChange={(e) => setAlias(e.target.value)}
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-sky-500 focus:border-sky-500"
                  placeholder="e.g. my-app-key"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-sky-500 focus:border-sky-500"
                    placeholder="••••••••"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Confirm</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:ring-sky-500 focus:border-sky-500"
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <div className="bg-amber-50 p-3 rounded-lg border border-amber-100 flex items-start gap-3">
                <AlertTriangleIcon className="h-4 w-4 text-amber-500 mt-0.5" />
                <p className="text-[11px] text-amber-800 leading-relaxed">
                  The password will be used to encrypt the PKCS#12 archive. <strong>Don't forget it!</strong>
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 font-medium">
              {error}
            </div>
          )}
        </div>

        <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-bold text-slate-600 hover:text-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            className="px-6 py-2 bg-sky-600 text-white text-sm font-bold rounded-lg hover:bg-sky-700 transition-colors shadow-sm"
          >
            Download {format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportModal;
