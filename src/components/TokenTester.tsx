import React, { useState, useEffect } from 'react';
import { 
  ServerIcon, 
  SendIcon, 
  PlusIcon, 
  TrashIcon, 
  KeyIcon, 
  FileCodeIcon,
  RefreshIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClipboardIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  InfoIcon,
  XIcon,
  UploadIcon,
  DownloadIcon,
  DatabaseIcon,
  EyeIcon,
  CertificateIcon,
  SaveIcon,
  BookmarkIcon
} from './icons';
import { getTokenTesterState, saveTokenTesterState, TokenTesterState } from '../services/tokenTesterStorage';
import { storageService } from '../services/storageService';
import { replaceVariables } from '../services/variableService';
import { toCurl, fromCurl } from '../services/curlParser';

const TokenTester: React.FC = () => {
  const [url, setUrl] = useState('https://httpbin.org/post');
  const [method, setMethod] = useState('POST');
  const [headers, setHeaders] = useState<{ key: string; value: string; enabled: boolean }[]>([
    { key: 'Content-Type', value: 'application/json', enabled: true },
    { key: 'Accept', value: 'application/json', enabled: true },
    { key: 'User-Agent', value: 'Security Tribe Toolkit', enabled: true }
  ]);
  const [authType, setAuthType] = useState<'none' | 'basic' | 'bearer'>('none');
  const [basicAuth, setBasicAuth] = useState({ user: '', pass: '' });
  const [bearerToken, setBearerToken] = useState('');
  const [bodyType, setBodyType] = useState<'json' | 'form'>('json');
  const [body, setBody] = useState('{\n  "message": "Hello from Security Tribe!"\n}');
  const [formData, setFormData] = useState<{ key: string; value: string; enabled: boolean }[]>([
    { key: 'grant_type', value: 'authorization_code', enabled: true },
    { key: 'code', value: '', enabled: true },
    { key: 'client_id', value: '', enabled: true }
  ]);
  
  const [response, setResponse] = useState<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: string;
    time: number;
  } | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'request' | 'response'>('request');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [showCollectionPicker, setShowCollectionPicker] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [secrets, setSecrets] = useState<any[]>([]);
  const [variables, setVariables] = useState<{ key: string; value: string; enabled: boolean }[]>([]);
  const [showVariableManager, setShowVariableManager] = useState(false);
  const [showCurlImport, setShowCurlImport] = useState(false);
  const [showImportDropdown, setShowImportDropdown] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [collectionPickerMode, setCollectionPickerMode] = useState<'bearer' | 'import'>('bearer');
  const [showAuthDropdown, setShowAuthDropdown] = useState(false);
  const [curlCommand, setCurlCommand] = useState('');

  // Auto-hide toast
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Load secrets for collection picker
  useEffect(() => {
    if (showCollectionPicker) {
      const loadCollection = async () => {
        try {
          const allItems = await storageService.getItems();
          setSecrets(allItems); // Allow all items per user request
        } catch (err) {
          console.error('Failed to load collections', err);
        }
      };
      loadCollection();
    }
  }, [showCollectionPicker]);

  // Load state from IndexedDB
  useEffect(() => {
    const loadState = async () => {
      try {
        const savedState = await getTokenTesterState();
        if (savedState) {
          setUrl(savedState.url);
          setMethod(savedState.method);
          setHeaders(savedState.headers);
          setAuthType(savedState.authType);
          if (savedState.basicAuth) setBasicAuth(savedState.basicAuth);
          if (savedState.bearerToken) setBearerToken(savedState.bearerToken);
          setBodyType(savedState.bodyType);
          setBody(savedState.body);
          if (savedState.formData) setFormData(savedState.formData);
          if (savedState.variables) setVariables(savedState.variables);
        }
      } catch (err) {
        console.error('Failed to load token tester state', err);
      } finally {
        setIsLoaded(true);
      }
    };
    loadState();
  }, []);

  // Save state to IndexedDB on change
  useEffect(() => {
    if (!isLoaded) return;
    
    const state: TokenTesterState = {
      url,
      method,
      headers,
      authType,
      basicAuth,
      bearerToken,
      bodyType,
      body,
      formData,
      variables
    };
    saveTokenTesterState(state).catch(err => console.error('Failed to save state', err));
  }, [isLoaded, url, method, headers, authType, basicAuth, bearerToken, bodyType, body, formData, variables]); 

  const handleAddHeader = () => {
    setHeaders([...headers, { key: '', value: '', enabled: true }]);
  };

  const handleRemoveHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index));
  };

  const handleHeaderChange = (index: number, field: 'key' | 'value' | 'enabled', value: any) => {
    const newHeaders = [...headers];
    (newHeaders[index] as any)[field] = value;
    setHeaders(newHeaders);
  };
  
  const handleAddFormData = () => {
    setFormData([...formData, { key: '', value: '', enabled: true }]);
  };

  const handleRemoveFormData = (index: number) => {
    const newFormData = formData.filter((_, i) => i !== index);
    setFormData(newFormData);
    if (bodyType === 'form') {
      const bodyStr = newFormData
        .filter(item => item.enabled && item.key.trim())
        .map(item => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`)
        .join('&');
      setBody(bodyStr);
    }
  };

  const handleFormDataChange = (index: number, field: 'key' | 'value' | 'enabled', value: any) => {
    const newFormData = [...formData];
    (newFormData[index] as any)[field] = value;
    setFormData(newFormData);
    
    if (bodyType === 'form') {
      const bodyStr = newFormData
        .filter(item => item.enabled && item.key.trim())
        .map(item => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`)
        .join('&');
      setBody(bodyStr);
    }
  };

  const showNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
  };

  const handleSendRequest = async () => {
    setLoading(true);
    setError(null);
    setResponse(null);
    setActiveTab('response');
    
    const startTime = Date.now();
    
    try {
      // Apply variable replacement to all request components
      const finalUrl = replaceVariables(url, variables);
      const finalBearerToken = replaceVariables(bearerToken, variables);
      const finalBasicUser = replaceVariables(basicAuth.user, variables);
      const finalBasicPass = replaceVariables(basicAuth.pass, variables);

      let finalBody = '';
      if (bodyType === 'form') {
        finalBody = formData
          .filter(item => item.enabled && item.key.trim())
          .map(item => {
              const k = replaceVariables(item.key, variables);
              const v = replaceVariables(item.value, variables);
              return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
          })
          .join('&');
      } else {
        finalBody = replaceVariables(body, variables);
      }

      const requestHeaders: Record<string, string> = {};
      headers.forEach(h => {
        if (h.enabled && h.key.trim()) {
            requestHeaders[replaceVariables(h.key, variables)] = replaceVariables(h.value, variables);
        }
      });

      if (authType === 'basic' && finalBasicUser) {
        requestHeaders['Authorization'] = `Basic ${btoa(`${finalBasicUser}:${finalBasicPass}`)}`;
      } else if (authType === 'bearer' && finalBearerToken) {
        requestHeaders['Authorization'] = `Bearer ${finalBearerToken}`;
      }

      // Add Content-Type if missing for POST/PUT
      if ((method === 'POST' || method === 'PUT') && !requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = bodyType === 'json' ? 'application/json' : 'application/x-www-form-urlencoded';
      }

      const options: RequestInit = {
        method,
        headers: requestHeaders,
      };

      if (method !== 'GET' && method !== 'HEAD') {
        options.body = finalBody;
      }

      const res = await fetch(finalUrl, options);
      const endTime = Date.now();
      
      const responseHeaders: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      let responseBody = '';
      try {
        const text = await res.text();
        try {
          responseBody = JSON.stringify(JSON.parse(text), null, 2);
        } catch {
          responseBody = text;
        }
      } catch (e) {
        responseBody = 'Error reading response body';
      }

      setResponse({
        status: res.status,
        statusText: res.statusText,
        headers: responseHeaders,
        body: responseBody,
        time: endTime - startTime
      });
      
      if (res.ok) {
        showNotification(`Success: ${res.status} ${res.statusText}`, 'success');
      } else {
        showNotification(`Failed: ${res.status} ${res.statusText}`, 'error');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to send request. Check console for details (CORS might be an issue).');
      showNotification('Request failed. See response panel for details.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleCurlImport = (command?: string) => {
    const targetCommand = command || curlCommand;
    const config = fromCurl(targetCommand);
    if (config) {
      if (config.url) setUrl(config.url);
      if (config.method) setMethod(config.method);
      if (config.headers) {
          const newHeaders = config.headers.map(h => ({ ...h, enabled: true }));
          setHeaders(newHeaders);
      }
      if (config.body) setBody(config.body);
      if (config.authType) setAuthType(config.authType);
      if (config.bearerToken) setBearerToken(config.bearerToken);
      if (config.basicAuth) setBasicAuth(config.basicAuth);
      
      setShowCurlImport(false);
      setCurlCommand('');
      showNotification('Request imported successfully', 'success');
    } else {
      showNotification('Invalid CURL command', 'error');
    }
  };

  const getCurlRepresentation = () => {
    let finalBody = body;
    if (bodyType === 'form') {
      finalBody = formData
        .filter(item => item.enabled && item.key.trim())
        .map(item => {
            const k = replaceVariables(item.key, variables);
            const v = replaceVariables(item.value, variables);
            return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
        })
        .join('&');
    } else {
      finalBody = replaceVariables(body, variables);
    }

    return toCurl({
      url: replaceVariables(url, variables),
      method,
      headers: headers.map(h => ({
          ...h,
          key: replaceVariables(h.key, variables),
          value: replaceVariables(h.value, variables),
          enabled: h.enabled || false
      })),
      body: finalBody,
      authType,
      basicAuth: {
          user: replaceVariables(basicAuth.user, variables),
          pass: replaceVariables(basicAuth.pass, variables)
      },
      bearerToken: replaceVariables(bearerToken, variables)
    });
  };

  const handleSaveToCollection = async () => {
    if (!saveName.trim()) {
      showNotification('Please enter a name for the request', 'error');
      return;
    }

    try {
      const curl = getCurlRepresentation();
      await storageService.saveItem({
        title: saveName,
        type: 'request',
        content: curl,
        metadata: {
          url,
          method,
          timestamp: Date.now()
        }
      });
      setShowSaveModal(false);
      setSaveName('');
      showNotification('Request saved to collection', 'success');
    } catch (err) {
      showNotification('Failed to save request', 'error');
      console.error(err);
    }
  };

  const handleCopyAsCurl = () => {
    const curl = getCurlRepresentation();
    navigator.clipboard.writeText(curl);
    showNotification('CURL command copied to clipboard (variables resolved)', 'success');
  };

  const handleAddVariable = () => {
    setVariables([...variables, { key: '', value: '', enabled: true }]);
  };

  const handleVariableChange = (index: number, field: 'key' | 'value' | 'enabled', value: any) => {
    const newVars = [...variables];
    (newVars[index] as any)[field] = value;
    setVariables(newVars);
  };

  const findJwtInString = (str: string): string | null => {
    // Basic JWT regex: header.payload.signature
    const jwtRegex = /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g;
    const matches = str.match(jwtRegex);
    return matches ? matches[0] : null;
  };

  const handleInspectJwt = (token: string) => {
    localStorage.setItem('SecurityTribeToolkit_encoded_jwt', token);
    const event = new CustomEvent('app-change-view', { detail: 'Decode' });
    window.dispatchEvent(event);
    showNotification('Token sent to Decoder', 'success');
  };

  const loadFromEncoder = () => {
    const encodedJwt = localStorage.getItem('SecurityTribeToolkit_encoded_jwt');
    if (encodedJwt) {
      setBearerToken(encodedJwt);
      setAuthType('bearer');
      showNotification('JWT loaded from Encoder', 'success');
    } else {
      showNotification('No encoded JWT found. Go to JWT Encoder first.', 'error');
    }
  };

  const getFormedRequest = () => {
    const finalUrl = replaceVariables(url, variables);
    const requestHeaders: Record<string, string> = {};
    
    headers.forEach(h => {
        if (h.enabled && h.key.trim()) {
            requestHeaders[replaceVariables(h.key, variables)] = replaceVariables(h.value, variables);
        }
    });

    if (authType === 'basic' && basicAuth.user) {
        const u = replaceVariables(basicAuth.user, variables);
        const p = replaceVariables(basicAuth.pass, variables);
        requestHeaders['Authorization'] = `Basic ${btoa(`${u}:${p}`)}`;
    } else if (authType === 'bearer' && bearerToken) {
        requestHeaders['Authorization'] = `Bearer ${replaceVariables(bearerToken, variables)}`;
    }

    if ((method === 'POST' || method === 'PUT') && !requestHeaders['Content-Type']) {
        requestHeaders['Content-Type'] = bodyType === 'json' ? 'application/json' : 'application/x-www-form-urlencoded';
    }

    let finalBody = '';
    if (bodyType === 'form') {
        finalBody = formData
          .filter(item => item.enabled && item.key.trim())
          .map(item => {
              const k = replaceVariables(item.key, variables);
              const v = replaceVariables(item.value, variables);
              return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
          })
          .join('&');
    } else {
        finalBody = replaceVariables(body, variables);
    }

    return `${method} ${finalUrl} HTTP/1.1\n` +
           Object.entries(requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n') +
           (method !== 'GET' && method !== 'HEAD' ? `\n\n${finalBody}` : '');
  };


  return (
    <div className="space-y-6 relative">

      {/* Collection Picker Modal */}
      {showCollectionPicker && (
          <div className="fixed inset-0 z-[90] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-fade-in">
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
                      {secrets.filter(s => {
                          if (collectionPickerMode === 'import') return s.type === 'request';
                          return s.type !== 'request';
                      }).length === 0 ? (
                          <div className="p-8 text-center text-slate-400 italic">
                              {collectionPickerMode === 'import' ? 'No saved requests found.' : 'No items found in collections.'}
                          </div>
                      ) : (
                          secrets.filter(s => {
                              if (collectionPickerMode === 'import') return s.type === 'request';
                              return s.type !== 'request';
                          }).map(s => (
                              <button 
                                key={s.id}
                                onClick={() => {
                                    if (collectionPickerMode === 'import') {
                                        handleCurlImport(s.content);
                                    } else {
                                        setBearerToken(s.content);
                                        setAuthType('bearer');
                                    }
                                    setShowCollectionPicker(false);
                                    showNotification(`Loaded: ${s.title}`, 'success');
                                }}
                                className="w-full text-left p-3 hover:bg-sky-50 rounded-xl transition-colors flex items-center group mb-1 border border-transparent hover:border-sky-100"
                              >
                                  <div className="bg-sky-100 p-2 rounded-lg mr-3 group-hover:bg-sky-200 transition-colors">
                                       {s.type === 'key' ? <KeyIcon className="h-4 w-4 text-sky-600" /> :
                                        s.type === 'jwt' ? <FileCodeIcon className="h-4 w-4 text-sky-600" /> :
                                        s.type === 'certificate' ? <CertificateIcon className="h-4 w-4 text-sky-600" /> :
                                        s.type === 'request' ? <UploadIcon className="h-4 w-4 text-sky-600" /> :
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

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="bg-sky-50 p-2 rounded-lg border border-sky-100">
            <ServerIcon className="h-6 w-6 text-sky-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Token Endpoint Tester</h1>
            <p className="text-slate-500">Test OAuth2/OIDC token endpoints or any REST API.</p>
          </div>
        </div>
        
        <div className="flex space-x-2">
            <button
                onClick={() => setShowVariableManager(true)}
                className="flex items-center px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm active:translate-y-px"
                title="Manage {{variables}}"
            >
                <DatabaseIcon className="h-4 w-4 mr-2 text-sky-500" />
                Variables
            </button>
            <div className="relative">
                <button
                    onClick={() => setShowImportDropdown(!showImportDropdown)}
                    className="flex items-center px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors text-sm font-medium shadow-sm active:translate-y-px"
                    title="Import options"
                >
                    <UploadIcon className="h-4 w-4 mr-2 text-sky-500" />
                    Import
                    <ChevronDownIcon className={`ml-2 h-4 w-4 transition-transform ${showImportDropdown ? 'rotate-180' : ''}`} />
                </button>

                {showImportDropdown && (
                    <>
                        <div 
                            className="fixed inset-0 z-40" 
                            onClick={() => setShowImportDropdown(false)}
                        />
                        <div className="absolute top-full right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in py-1 min-w-[200px]">
                            <button
                                onClick={() => {
                                    setShowCurlImport(true);
                                    setShowImportDropdown(false);
                                }}
                                className="w-full flex items-center px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-sky-50 transition-colors"
                            >
                                <ClipboardIcon className="h-4 w-4 mr-2 text-sky-500" />
                                Paste CURL Command
                            </button>
                            <button
                                onClick={() => {
                                    setCollectionPickerMode('import');
                                    setShowCollectionPicker(true);
                                    setShowImportDropdown(false);
                                }}
                                className="w-full flex items-center px-4 py-2.5 text-left text-sm text-slate-600 hover:bg-sky-50 transition-colors border-t border-slate-50"
                            >
                                <DatabaseIcon className="h-4 w-4 mr-2 text-sky-500" />
                                Load from Collection
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
      </div>

      {/* Variable Manager Modal */}
      {showVariableManager && (
          <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <DatabaseIcon className="h-5 w-5 text-sky-600" />
                        <h3 className="font-bold text-slate-800">Manage Variables</h3>
                      </div>
                      <button onClick={() => setShowVariableManager(false)} className="p-1 hover:bg-slate-200 rounded-lg transition-colors">
                          <XIcon className="h-5 w-5 text-slate-500" />
                      </button>
                  </div>
                  <div className="p-6 space-y-4">
                      <p className="text-xs text-slate-500 italic">Define variables here and use them in the URL, Headers, or Body as <code className="bg-slate-100 px-1 rounded text-sky-600">{"{{KEY}}"}</code>.</p>
                      
                      <div className="space-y-2 max-h-[400px] overflow-y-auto custom-scrollbar pr-2">
                          {variables.length === 0 ? (
                              <div className="p-8 text-center text-slate-400 border-2 border-dashed border-slate-100 rounded-xl">No variables defined.</div>
                          ) : (
                              variables.map((v, index) => (
                                  <div key={index} className="flex items-center space-x-2 animate-fade-in">
                                      <input 
                                          type="checkbox"
                                          checked={v.enabled}
                                          onChange={(e) => handleVariableChange(index, 'enabled', e.target.checked)}
                                          className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                                      />
                                      <input 
                                          type="text"
                                          value={v.key}
                                          onChange={(e) => handleVariableChange(index, 'key', e.target.value)}
                                          placeholder="VARIABLE_NAME"
                                          className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono focus:ring-1 focus:ring-sky-500 outline-none"
                                      />
                                      <input 
                                          type="text"
                                          value={v.value}
                                          onChange={(e) => handleVariableChange(index, 'value', e.target.value)}
                                          placeholder="value"
                                          className="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-sky-500 outline-none"
                                      />
                                      <button 
                                          onClick={() => setVariables(variables.filter((_, i) => i !== index))}
                                          className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                                      >
                                          <TrashIcon className="h-4 w-4" />
                                      </button>
                                  </div>
                              ))
                          )}
                      </div>
                      <button 
                          onClick={handleAddVariable}
                          className="w-full py-2 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:border-sky-300 hover:text-sky-500 transition-all flex items-center justify-center text-sm font-medium"
                      >
                          <PlusIcon className="h-4 w-4 mr-2" /> Add Variable
                      </button>
                  </div>
                  <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end">
                      <button 
                        onClick={() => setShowVariableManager(false)}
                        className="px-6 py-2 bg-sky-600 text-white rounded-lg font-bold text-sm hover:bg-sky-700 transition-all shadow-md"
                      >
                          Done
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* CURL Import Modal */}
      {showCurlImport && (
          <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-fade-in">
                  <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <UploadIcon className="h-5 w-5 text-sky-600" />
                        <h3 className="font-bold text-slate-800">Import from CURL</h3>
                      </div>
                      <button onClick={() => setShowCurlImport(false)} className="p-1 hover:bg-slate-200 rounded-lg transition-colors">
                          <XIcon className="h-5 w-5 text-slate-500" />
                      </button>
                  </div>
                  <div className="p-6 space-y-4">
                      <textarea 
                          value={curlCommand}
                          onChange={(e) => setCurlCommand(e.target.value)}
                          placeholder="Paste curl command here..."
                          className="w-full h-48 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:ring-2 focus:ring-sky-500 outline-none"
                      />
                      <p className="text-[10px] text-slate-400 italic">Supports URL, -X (Method), -H (Headers), and -d (Body).</p>
                  </div>
                  <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end space-x-3">
                      <button 
                        onClick={() => setShowCurlImport(false)}
                        className="px-4 py-2 text-slate-500 font-medium text-sm hover:text-slate-700"
                      >
                          Cancel
                      </button>
                      <button 
                        onClick={handleCurlImport}
                        className="px-6 py-2 bg-sky-600 text-white rounded-lg font-bold text-sm hover:bg-sky-700 transition-all shadow-md"
                      >
                          Import Request
                      </button>
                  </div>
              </div>
          </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        {/* Left Column: Request Configuration */}
        <div className={`flex flex-col gap-6 ${activeTab === 'response' && 'hidden lg:flex'}`}>
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex-1">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Request Configuration</h2>
              <button
                onClick={() => setShowSaveModal(true)}
                className="flex items-center px-3 py-1 text-[10px] font-bold text-sky-600 bg-sky-50 border border-sky-100 rounded-lg hover:bg-sky-100 transition-all uppercase tracking-tight shadow-sm active:translate-y-px"
              >
                <BookmarkIcon className="h-3 w-3 mr-1.5" />
                Save to Collection
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              {/* URL & Method */}
              <div className="flex space-x-2">
                <select 
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className="w-24 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                >
                  <option>GET</option>
                  <option>POST</option>
                  <option>PUT</option>
                  <option>DELETE</option>
                </select>
                <input 
                  type="text"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://auth-server.com/token"
                  className="flex-1 px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500"
                />
                <button 
                  onClick={handleSendRequest}
                  disabled={loading}
                  className={`px-6 py-2 rounded-lg flex items-center font-bold text-sm transition-all shadow-md active:scale-95 ${
                    loading 
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                    : 'bg-sky-600 text-white hover:bg-sky-700'
                  }`}
                >
                  {loading ? <RefreshIcon className="h-4 w-4 animate-spin mr-2" /> : <SendIcon className="h-4 w-4 mr-2" />}
                  SEND
                </button>
              </div>

              {/* Auth Selection */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Authentication</label>
                <div className="flex space-x-2">
                  {(['none', 'basic'] as const).map(type => (
                    <button
                      key={type}
                      onClick={() => {
                        setAuthType(type);
                        setShowAuthDropdown(false);
                      }}
                      className={`flex-1 py-1.5 text-xs font-medium rounded-md border transition-all ${
                        authType === type 
                        ? 'bg-sky-50 border-sky-200 text-sky-700' 
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {type.toUpperCase()}
                    </button>
                  ))}
                  <div className="flex-1 relative">
                    <button
                      onClick={() => {
                        setAuthType('bearer');
                        setShowAuthDropdown(!showAuthDropdown);
                      }}
                      className={`w-full flex items-center justify-center space-x-1 py-1.5 text-xs font-medium rounded-md border transition-all ${
                        authType === 'bearer' 
                        ? 'bg-sky-50 border-sky-200 text-sky-700' 
                        : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <span>BEARER</span>
                      <ChevronDownIcon className={`h-3 w-3 transition-transform ${showAuthDropdown ? 'rotate-180' : ''}`} />
                    </button>

                    {showAuthDropdown && (
                        <>
                            <div 
                                className="fixed inset-0 z-40" 
                                onClick={() => setShowAuthDropdown(false)}
                            />
                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-xl z-50 overflow-hidden animate-fade-in py-1 min-w-[160px]">
                                <button
                                    onClick={() => {
                                        loadFromEncoder();
                                        setShowAuthDropdown(false);
                                    }}
                                    className="w-full flex items-center px-3 py-2 text-left text-[11px] text-slate-600 hover:bg-sky-50 transition-colors"
                                >
                                    <FileCodeIcon className="h-3.5 w-3.5 mr-2 text-sky-500" />
                                    Load from Encoder
                                </button>
                                <button
                                    onClick={() => {
                                        setCollectionPickerMode('bearer');
                                        setShowCollectionPicker(true);
                                        setShowAuthDropdown(false);
                                    }}
                                    className="w-full flex items-center px-3 py-2 text-left text-[11px] text-slate-600 hover:bg-sky-50 transition-colors border-t border-slate-50"
                                >
                                    <DatabaseIcon className="h-3.5 w-3.5 mr-2 text-sky-500" />
                                    Load from Collection
                                </button>
                                <button
                                    onClick={async () => {
                                        try {
                                            const text = await navigator.clipboard.readText();
                                            if (text) {
                                                setBearerToken(text.trim());
                                                setAuthType('bearer');
                                                showNotification('Token pasted from clipboard', 'success');
                                            }
                                        } catch (err) {
                                            showNotification('Failed to read clipboard', 'error');
                                        }
                                        setShowAuthDropdown(false);
                                    }}
                                    className="w-full flex items-center px-3 py-2 text-left text-[11px] text-slate-600 hover:bg-sky-50 transition-colors border-t border-slate-50"
                                >
                                    <ClipboardIcon className="h-3.5 w-3.5 mr-2 text-sky-500" />
                                    Paste from Clipboard
                                </button>
                            </div>
                        </>
                    )}
                  </div>
                </div>
                
                {authType === 'basic' && (
                  <div className="grid grid-cols-2 gap-2 animate-fade-in">
                    <input 
                      type="text"
                      value={basicAuth.user}
                      onChange={(e) => setBasicAuth({...basicAuth, user: e.target.value})}
                      placeholder="Username"
                      className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-sky-500 outline-none"
                    />
                    <input 
                      type="password"
                      value={basicAuth.pass}
                      onChange={(e) => setBasicAuth({...basicAuth, pass: e.target.value})}
                      placeholder="Password"
                      className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-sky-500 outline-none"
                    />
                  </div>
                )}
                
                {authType === 'bearer' && (
                  <div className="animate-fade-in relative">
                    <input 
                      type="password"
                      value={bearerToken}
                      onChange={(e) => setBearerToken(e.target.value)}
                      placeholder="Bearer Token (JWT or Secret)"
                      className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-sky-500 outline-none"
                    />
                  </div>
                )}
              </div>

              {/* Headers */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Headers</label>
                  <button 
                    onClick={handleAddHeader}
                    className="text-sky-600 hover:text-sky-700 text-xs font-medium flex items-center"
                  >
                    <PlusIcon className="h-3 w-3 mr-1" /> Add Header
                  </button>
                </div>
                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-1">
                  {headers.map((header, index) => (
                    <div key={index} className="flex items-center space-x-2 animate-fade-in group">
                      <input 
                        type="checkbox"
                        checked={header.enabled}
                        onChange={(e) => handleHeaderChange(index, 'enabled', e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                        title="Enable/Disable Header"
                      />
                      <input 
                        type="text"
                        value={header.key}
                        onChange={(e) => handleHeaderChange(index, 'key', e.target.value)}
                        placeholder="Header Name"
                        className={`flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-sky-500 outline-none ${!header.enabled && 'opacity-50'}`}
                      />
                      <input 
                        type="text"
                        value={header.value}
                        onChange={(e) => handleHeaderChange(index, 'value', e.target.value)}
                        placeholder="Value"
                        className={`flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-sky-500 outline-none ${!header.enabled && 'opacity-50'}`}
                      />
                      <button 
                        onClick={() => handleRemoveHeader(index)}
                        className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Body */}
              {method !== 'GET' && method !== 'HEAD' && (
                <div className="space-y-3 animate-fade-in">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Body</label>
                    <div className="flex bg-slate-100 p-0.5 rounded-md">
                      <button 
                        onClick={() => {
                            setBodyType('json');
                            // Sync form data to JSON body
                            try {
                                const obj: any = {};
                                formData.forEach(f => {
                                    if (f.enabled && f.key.trim()) obj[f.key] = f.value;
                                });
                                setBody(JSON.stringify(obj, null, 2));
                            } catch (e) {
                                // Default fallback if sync fails
                            }
                            
                            // Update Content-Type header if it exists
                            const ctIndex = headers.findIndex(h => h.key.toLowerCase() === 'content-type');
                            if (ctIndex !== -1) {
                                handleHeaderChange(ctIndex, 'value', 'application/json');
                            }
                        }}
                        className={`px-2 py-0.5 text-[10px] rounded transition-all ${bodyType === 'json' ? 'bg-white shadow-sm font-bold' : 'text-slate-400'}`}
                      >
                        JSON
                      </button>
                      <button 
                         onClick={() => {
                             setBodyType('form');
                             // Sync JSON body to form data
                             try {
                                 const obj = JSON.parse(body);
                                 const newFormData = Object.entries(obj).map(([key, value]) => ({ 
                                     key, 
                                     value: typeof value === 'object' ? JSON.stringify(value) : String(value),
                                     enabled: true
                                 }));
                                 if (newFormData.length > 0) setFormData(newFormData);
                                 
                                 const bodyStr = newFormData
                                    .filter(item => item.key.trim())
                                    .map(item => `${encodeURIComponent(item.key)}=${encodeURIComponent(item.value)}`)
                                    .join('&');
                                 setBody(bodyStr);
                             } catch (e) {
                                 // If body is already url-encoded, try to parse it
                                 if (body.includes('=') || body.includes('&')) {
                                     const params = new URLSearchParams(body);
                                     const newFormData: {key: string, value: string, enabled: boolean}[] = [];
                                     params.forEach((value, key) => {
                                         newFormData.push({ key, value, enabled: true });
                                     });
                                     if (newFormData.length > 0) setFormData(newFormData);
                                 }
                             }

                             // Update Content-Type header if it exists
                             const ctIndex = headers.findIndex(h => h.key.toLowerCase() === 'content-type');
                             if (ctIndex !== -1) {
                                 handleHeaderChange(ctIndex, 'value', 'application/x-www-form-urlencoded');
                             }
                         }}
                        className={`px-2 py-0.5 text-[10px] rounded transition-all ${bodyType === 'form' ? 'bg-white shadow-sm font-bold' : 'text-slate-400'}`}
                      >
                        FORM
                      </button>
                    </div>
                  </div>
                  
                  {bodyType === 'json' ? (
                    <textarea 
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={6}
                      className="w-full px-3 py-2 bg-slate-800 text-sky-400 font-mono text-xs rounded-lg focus:ring-1 focus:ring-sky-500 outline-none"
                      placeholder='{ "key": "value" }'
                    />
                  ) : (
                    <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
                        {formData.map((item, index) => (
                          <div key={index} className="flex items-center space-x-2 animate-fade-in group">
                            <input 
                              type="checkbox"
                              checked={item.enabled}
                              onChange={(e) => handleFormDataChange(index, 'enabled', e.target.checked)}
                              className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                              title="Enable/Disable Parameter"
                            />
                            <input 
                              type="text"
                              value={item.key}
                              onChange={(e) => handleFormDataChange(index, 'key', e.target.value)}
                              placeholder="Key"
                              className={`flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-sky-500 outline-none ${!item.enabled && 'opacity-50'}`}
                            />
                            <input 
                              type="text"
                              value={item.value}
                              onChange={(e) => handleFormDataChange(index, 'value', e.target.value)}
                              placeholder="Value"
                              className={`flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded text-xs focus:ring-1 focus:ring-sky-500 outline-none ${!item.enabled && 'opacity-50'}`}
                            />
                            <button 
                              onClick={() => handleRemoveFormData(index)}
                              className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <button 
                            onClick={handleAddFormData}
                            className="w-full py-2 border-2 border-dashed border-slate-200 rounded-lg text-slate-400 hover:border-sky-300 hover:text-sky-500 transition-all flex items-center justify-center text-xs font-medium"
                        >
                            <PlusIcon className="h-3 w-3 mr-1" /> Add Parameter
                        </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Formed Request Accordion */}
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <details className="group">
                <summary className="p-4 list-none cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors flex items-center justify-between border-b border-slate-100 shadow-sm">
                    <div className="flex items-center space-x-2">
                        <FileCodeIcon className="h-4 w-4 text-slate-400" />
                        <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider font-bold">Formed Request</h2>
                    </div>
                    <ChevronDownIcon className="h-4 w-4 text-slate-400 group-open:rotate-180 transition-transform" />
                </summary>
                <div className="p-0 bg-slate-800 relative">
                    <div className="absolute top-4 right-4 flex space-x-2 z-10">
                        <button 
                            onClick={handleCopyAsCurl}
                            className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition-colors"
                            title="Copy as CURL"
                        >
                            <DownloadIcon className="h-4 w-4" />
                        </button>
                        <button 
                            onClick={() => {
                                navigator.clipboard.writeText(getFormedRequest());
                                showNotification('Request copied!', 'success');
                            }}
                            className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 transition-colors"
                            title="Copy raw request"
                        >
                            <ClipboardIcon className="h-4 w-4" />
                        </button>
                    </div>
                    <pre className="text-[10px] font-mono text-sky-400 p-6 whitespace-pre-wrap break-all custom-scrollbar leading-relaxed">
                        {getFormedRequest()}
                    </pre>
                </div>
            </details>
          </div>
        </div>

        {/* Right Column: Response / Results */}
        <div className={`flex flex-col gap-6 ${activeTab === 'request' && 'hidden lg:flex'}`}>
          {/* Mobile Tab Switcher - Strictly only for mobile to prevent any desktop layout shift */}
          {activeTab && (
            <div className="lg:hidden flex border-b border-slate-200 bg-white rounded-t-xl overflow-hidden shadow-sm">
                <button 
                    onClick={() => setActiveTab('request')}
                    className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'request' ? 'border-sky-500 text-sky-600 bg-sky-50/30' : 'border-transparent text-slate-500'}`}
                >
                    Request
                </button>
                <button 
                    onClick={() => setActiveTab('response')}
                    className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'response' ? 'border-sky-500 text-sky-600 bg-sky-50/30' : 'border-transparent text-slate-500'}`}
                >
                    Response
                </button>
            </div>
          )}

          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex-1 flex flex-col min-h-[600px]">
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Response</h2>
              {response && (
                <div className="flex items-center space-x-3 text-xs">
                  <span className={`font-bold px-2 py-0.5 rounded-full ${
                    response.status >= 200 && response.status < 300 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'
                  }`}>
                    {response.status} {response.statusText}
                  </span>
                  <span className="text-slate-400">{response.time} ms</span>
                </div>
              )}
            </div>

            <div className="flex-1 p-0 overflow-hidden relative">
              {loading ? (
                <div className="absolute inset-0 z-10 bg-white/80 flex flex-col items-center justify-center space-y-4">
                  <RefreshIcon className="h-10 w-10 text-sky-500 animate-spin" />
                  <p className="text-slate-500 font-medium italic animate-pulse">Waiting for server response...</p>
                </div>
              ) : error ? (
                <div className="p-8 h-full flex flex-col items-center justify-center text-center space-y-4">
                  <div className="p-4 bg-red-50 rounded-full">
                    <XCircleIcon className="h-12 w-12 text-red-500" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Request Failed</h3>
                    <p className="text-slate-500 mt-1 max-w-sm mx-auto">{error}</p>
                    <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg text-left text-xs text-slate-600">
                        <p className="font-bold mb-2">Troubleshooting Tips:</p>
                        <ul className="list-disc pl-4 space-y-1">
                            <li>Is the URL correct and accessible?</li>
                            <li><strong>CORS Warning:</strong> If the server doesn't allow cross-origin requests from this domain, it will fail.</li>
                            <li>Check the browser developer tools (F12) Console for specific security errors.</li>
                        </ul>
                    </div>
                  </div>
                </div>
              ) : response ? (
                <div className="h-full flex flex-col custom-scrollbar overflow-y-auto">
                    {/* Tiny headers preview toggle */}
                    <details className="border-b border-slate-100 group">
                        <summary className="px-6 py-2 list-none cursor-pointer hover:bg-slate-50 transition-colors flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Headers ({Object.keys(response.headers).length})</span>
                            <ChevronDownIcon className="h-4 w-4 text-slate-400 group-open:rotate-180 transition-transform" />
                        </summary>
                        <div className="px-6 py-4 bg-slate-50 space-y-1 border-t border-slate-100">
                            {Object.entries(response.headers).map(([k, v]) => (
                                <div key={k} className="flex text-[10px] font-mono">
                                    <span className="text-slate-400 w-32 shrink-0">{k}:</span>
                                    <span className="text-slate-700 break-all">{v}</span>
                                </div>
                            ))}
                        </div>
                    </details>

                    <div className="flex-1 p-6 space-y-4">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Response Body</label>
                            <div className="flex space-x-2">
                                {findJwtInString(response.body) && (
                                    <button 
                                        onClick={() => handleInspectJwt(findJwtInString(response.body)!)}
                                        className="flex items-center px-2 py-1 bg-sky-100 text-sky-700 rounded text-[10px] font-bold hover:bg-sky-200 transition-colors animate-pulse"
                                        title="Decode detected JWT"
                                    >
                                        <EyeIcon className="h-3 w-3 mr-1" /> INSPECT TOKEN
                                    </button>
                                )}
                                <button 
                                    onClick={() => {
                                        navigator.clipboard.writeText(response.body);
                                        showNotification('Copied to clipboard', 'success');
                                    }}
                                    className="p-1.5 hover:bg-slate-100 rounded text-slate-400 transition-colors"
                                    title="Copy to clipboard"
                                >
                                    <ClipboardIcon className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                        <pre className="w-full h-full bg-slate-800 text-sky-400 p-6 rounded-xl font-mono text-xs overflow-auto custom-scrollbar border border-slate-700 shadow-inner leading-relaxed whitespace-pre-wrap break-all">
                            {response.body}
                        </pre>
                    </div>
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 space-y-4 opacity-30 select-none grayscale">
                  <div className="p-4 bg-slate-100 rounded-full">
                    <ServerIcon className="h-20 w-20 text-slate-300" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-400">Response Data</h3>
                    <p className="text-slate-400 mt-1">Configure your request and hit <strong>SEND</strong> to see results here.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer / Context Info */}
      <div className="bg-blue-50/50 border border-blue-100 rounded-xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between space-y-4 md:space-y-0">
        <div className="flex items-center space-x-4">
          <div className="bg-white p-2.5 rounded-full shadow-sm">
            <CheckCircleIcon className="h-6 w-6 text-blue-500" />
          </div>
          <div>
            <h4 className="text-blue-900 font-bold">Lab Integration</h4>
            <p className="text-blue-700/70 text-sm">Perfect for testing local Pega environments or internal services via browser.</p>
          </div>
        </div>
        <div className="text-xs text-blue-800/60 max-w-xs md:text-right font-medium italic">
          *Note: Browser-based requests are subject to CORS policies. If requests fail, ensure Target Server allows cross-origin requests.
        </div>
      </div>

      {/* Save to Collection Modal */}
      {showSaveModal && (
          <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-fade-in border border-sky-100">
                  <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                          <BookmarkIcon className="h-5 w-5 text-sky-600" />
                          <h3 className="font-bold text-slate-800">Save to Collection</h3>
                      </div>
                      <button onClick={() => setShowSaveModal(false)} className="p-1 hover:bg-sky-100 rounded-lg transition-colors">
                          <XIcon className="h-5 w-5 text-slate-500" />
                      </button>
                  </div>
                  <div className="p-6 space-y-4">
                      <div className="space-y-2">
                          <label className="text-xs font-bold text-slate-500 uppercase">Request Name</label>
                          <input 
                              type="text"
                              value={saveName}
                              onChange={(e) => setSaveName(e.target.value)}
                              onKeyDown={(e) => e.key === 'Enter' && handleSaveToCollection()}
                              placeholder="e.g., Get User Profile"
                              className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-sky-500 outline-none"
                              autoFocus
                          />
                      </div>
                      <p className="text-[10px] text-slate-400 italic">This will save the current configuration as a CURL command in your collection.</p>
                  </div>
                  <div className="p-4 bg-slate-50 border-t border-slate-100 flex justify-end space-x-3">
                      <button 
                          onClick={() => setShowSaveModal(false)}
                          className="px-4 py-2 text-slate-500 font-medium text-sm hover:text-slate-700"
                      >
                          Cancel
                      </button>
                      <button 
                          onClick={handleSaveToCollection}
                          className="px-6 py-2 bg-sky-600 text-white rounded-lg font-bold text-sm hover:bg-sky-700 transition-all shadow-md active:translate-y-px"
                      >
                          Save Request
                      </button>
                  </div>
              </div>
          </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #e2e8f0;
          border-radius: 10px;
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fade-in 0.3s ease-out forwards;
        }
      `}} />

      {/* Toast Notification (Moved to bottom to prevent layout shift) */}
      {toast && (
        <div className={`fixed top-8 right-8 z-[100] animate-fade-in flex items-center p-4 rounded-lg shadow-lg border transition-all ${
          toast.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 
          toast.type === 'error' ? 'bg-red-50 border-red-200 text-red-800' : 
          'bg-blue-50 border-blue-200 text-blue-800'
        }`}>
          {toast.type === 'success' ? <CheckCircleIcon className="h-5 w-5 mr-3" /> : 
           toast.type === 'error' ? <XCircleIcon className="h-5 w-5 mr-3" /> : 
           <InfoIcon className="h-5 w-5 mr-3" />}
          <span className="font-medium text-sm">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-4 hover:opacity-50 transition-opacity">
            <XIcon className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default TokenTester;
