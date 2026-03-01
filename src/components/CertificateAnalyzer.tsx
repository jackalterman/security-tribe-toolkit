import React, { useState } from 'react';
import CodeBlock from './CodeBlock';
import { certificateService, type CertificateInfo } from '../services/certificateService';
import { storageService } from '../services/storageService';
import { 
  SearchIcon, 
  DownloadIcon, 
  SaveIcon, 
  UploadIcon, 
  ShieldCheckIcon, 
  ArrowRightIcon,
  RefreshIcon,
  CertificateIcon,
  ExternalLinkIcon,
  ClipboardIcon
} from './icons';
import type { DecoderData } from '../types';
import ExportModal from './ExportModal';
import { jwtService } from '../services/jwtService';

interface CertificateAnalyzerProps {
  // onSendToDecoder removed as JWT decoder is not for public keys
}

const CertificateAnalyzer: React.FC<CertificateAnalyzerProps> = () => {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chain, setChain] = useState<CertificateInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manualPem, setManualPem] = useState('');
  const [selectedCertIndex, setSelectedCertIndex] = useState(0);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const handleFetch = async () => {
    if (!url) return;
    setIsLoading(true);
    setError(null);
    try {
      const certs = await certificateService.fetchFromUrl(url);
      setChain(certs);
      setSelectedCertIndex(0);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch certificates. Try pasting them manually.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleParseManual = () => {
    const pems = certificateService.splitChain(manualPem);
    if (pems.length === 0) {
      setError('No valid certificates found in input.');
      return;
    }
    const certs = pems.map(pem => certificateService.parsePem(pem));
    setChain(certs);
    setSelectedCertIndex(0);
    setError(null);
  };

  const handleExport = () => {
    setIsExportModalOpen(true);
  };

  const handleExportConfirm = (format: 'p12' | 'jwks' | 'pem', options: { password?: string; alias?: string }) => {
    if (chain.length === 0) return;
    const cert = chain[selectedCertIndex];
    
    try {
      if (format === 'pem') {
        certificateService.exportCertificate(cert.pem, `certificate-${selectedCertIndex}.pem`);
      } else if (format === 'p12') {
        // We don't have a private key here, but we can't really make a p12 without one in node-forge easily 
        // unless we use a dummy one or if the library allows it.
        // For now, if we don't have a private key, we'll inform the user or just export PEM.
        // Actually, let's just use the certificateService.exportCertificate for PEM as a fallback
        // or just allow PEM in this context.
        alert('PKCS#12 export requires a matching private key. Use the PEM Keys tab for private key export.');
      }
    } catch (e: any) {
      alert(`Export failed: ${e.message}`);
    }
  };

  const selectedCert = chain[selectedCertIndex];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Search / Input Area */}
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
        <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 tracking-wider">Analyze Certificate</h3>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <SearchIcon className="h-4 w-4 text-slate-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg focus:ring-sky-500 focus:border-sky-500 text-sm"
              placeholder="Enter domain (e.g. www.google.com)"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleFetch()}
            />
          </div>
          <button
            onClick={handleFetch}
            disabled={isLoading || !url}
            className={`px-6 py-2.5 bg-sky-600 text-white font-bold rounded-lg hover:bg-sky-700 transition-colors flex items-center gap-2 ${isLoading ? 'opacity-75 cursor-wait' : ''}`}
          >
            {isLoading ? <RefreshIcon className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
            Analyze
          </button>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Or Paste PEM Chain</label>
          <textarea
            className="w-full h-24 p-3 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs focus:ring-sky-500 focus:border-sky-500"
            placeholder="Paste your certificate PEM here..."
            value={manualPem}
            onChange={(e) => setManualPem(e.target.value)}
          />
          <button
            onClick={handleParseManual}
            className="mt-2 text-xs font-bold text-sky-600 hover:text-sky-700 flex items-center gap-1"
          >
            <UploadIcon className="h-3 w-3" />
            Parse Manual Input
          </button>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-600 flex items-start gap-2">
            <span className="font-bold">Error:</span> {error}
          </div>
        )}
      </div>

      {chain.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Analysis Results List */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col h-[500px]">
              <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-wider flex-none">Analysis Results</h4>
              <div className="space-y-2 overflow-y-auto pr-2 custom-scrollbar flex-1">
                {chain.map((cert, index) => (
                  <button
                    key={index}
                    onClick={() => setSelectedCertIndex(index)}
                    className={`w-full text-left p-3 rounded-lg border transition-all flex items-start gap-4 group ${
                      selectedCertIndex === index 
                        ? 'bg-sky-50 border-sky-200 ring-1 ring-sky-100' 
                        : 'bg-white border-slate-100 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className={`flex-none h-8 w-8 flex items-center justify-center rounded-full border-2 transition-all ${
                      selectedCertIndex === index 
                        ? 'bg-sky-600 border-sky-600 text-white shadow-sm' 
                        : 'bg-white border-slate-200 text-slate-400 group-hover:border-sky-400 group-hover:text-sky-500'
                    }`}>
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between items-center mb-1">
                        <p className={`text-xs font-bold truncate ${selectedCertIndex === index ? 'text-sky-700' : 'text-slate-600'}`}>
                          {index === 0 ? 'Latest Certificate' : `Entry #${index + 1}`}
                        </p>
                        {cert.type && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                            cert.type === 'Leaf' ? 'bg-green-100 text-green-700' :
                            cert.type === 'Root' ? 'bg-purple-100 text-purple-700' :
                            'bg-blue-100 text-blue-700'
                          }`}>
                            {cert.type}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 truncate mt-0.5">
                        {cert.subject.split(',')[0]}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
               <div className="flex items-center gap-2 mb-2">
                 <ShieldCheckIcon className="h-4 w-4 text-indigo-600" />
                 <span className="text-xs font-bold text-indigo-900 uppercase">Trust Status</span>
               </div>
               <p className="text-[11px] text-indigo-700 leading-relaxed">
                 Chain analyzed via public transparency logs. Trust should be verified against your local trust store.
               </p>
            </div>
          </div>

          {/* Details Area */}
          <div className="lg:col-span-7 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-[500px]">
            <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-sky-100 rounded-lg text-sky-600">
                  <CertificateIcon className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold text-slate-900">Certificate Details</h4>
                    {selectedCert?.type && (
                      <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                        selectedCert.type === 'Leaf' ? 'bg-green-100 text-green-700' :
                        selectedCert.type === 'Root' ? 'bg-purple-100 text-purple-700' :
                        'bg-blue-100 text-blue-700'
                      }`}>
                        {selectedCert.type}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500">Position {selectedCertIndex + 1} in analysis</p>
                </div>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => {
                    navigator.clipboard.writeText(selectedCert?.pem || '');
                    alert('PEM copied to clipboard');
                  }}
                  className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
                  title="Copy PEM"
                >
                  <ClipboardIcon className="h-4 w-4" />
                </button>
                <button 
                  onClick={handleExport}
                  className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition-colors"
                  title="Export to file"
                >
                  <DownloadIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto max-h-[500px]">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Subject</p>
                  <p className="text-sm text-slate-800 break-all">{selectedCert?.subject}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Issuer</p>
                  <p className="text-sm text-slate-800 break-all">{selectedCert?.issuer}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Valid From</p>
                  <p className="text-sm text-slate-800">{new Date(selectedCert?.validFrom).toLocaleString()}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Valid To</p>
                  <p className="text-sm text-slate-800">{new Date(selectedCert?.validTo).toLocaleString()}</p>
                </div>
                <div className="col-span-full space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Serial Number (Internal ID)</p>
                  <p className="text-sm font-mono text-slate-600 break-all">{selectedCert?.serialNumber}</p>
                </div>
                <div className="col-span-full space-y-1">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Public Key Thumbprint (SHA-256)</p>
                  <p className="text-sm font-mono text-slate-600 break-all">{selectedCert?.thumbprint}</p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase">PEM Content</p>
                <div className="bg-slate-900 rounded-lg p-3">
                  <CodeBlock content={selectedCert?.pem} />
                </div>
              </div>
            </div>
            
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex justify-end gap-3">
               <button 
                 onClick={() => {
                   if (!selectedCert) return;
                   storageService.saveItem({
                     type: 'certificate',
                     title: selectedCert.subject.split(',')[0],
                     content: selectedCert.pem,
                     metadata: {
                       issuer: selectedCert.issuer,
                       validFrom: selectedCert.validFrom,
                       validTo: selectedCert.validTo,
                       serial: selectedCert.serialNumber,
                       thumbprint: selectedCert.thumbprint
                     }
                   });
                   alert('Certificate saved to your collection!');
                 }}
                 className="flex items-center gap-2 px-6 py-2.5 bg-sky-600 text-white text-sm font-bold rounded-lg hover:bg-sky-700 transition-colors shadow-sm"
               >
                 <SaveIcon className="h-4 w-4" />
                 Save to Collection
               </button>
            </div>
          </div>
        </div>
      )}

      {selectedCert && (
        <ExportModal 
          isOpen={isExportModalOpen}
          onClose={() => setIsExportModalOpen(false)}
          onExport={handleExportConfirm}
          title="Export Certificate"
          allowP12={false} // Disable P12 if no private key
          allowJwks={false}
          allowPem={true}
          defaultAlias="certificate"
        />
      )}
    </div>
  );
};

export default CertificateAnalyzer;
