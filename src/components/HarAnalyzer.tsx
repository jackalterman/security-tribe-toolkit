import React, { useState, useMemo, useEffect } from 'react';
import { usePersistentState } from '../hooks/usePersistentState';
import { 
  SearchIcon, 
  RefreshIcon, 
  ArrowRightIcon, 
  ClipboardIcon, 
  CheckIcon,
  InfoIcon,
  DownloadIcon,
  TrashIcon,
  ActivityIcon,
  AlertTriangleIcon,
  SearchIcon as DetailIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  XIcon,
  UploadIcon
} from './icons';
import { HarRoot, HarEntry, filterEntries, parseHarFile } from '../services/har';
import { saveHarToDB, getHarFromDB, clearHarFromDB, getHarMetadataFromDB, deleteHarFromDB, HarMetadata } from '../services/harStorage';
import { jwtService } from '../services/jwtService';
import { detectFlows, hasUnreconstructedSamlTraffic, DetectedFlow } from '../services/harFlowDetector';
import { prettyPrintBody } from '../utils/prettyPrint';
import JsonViewer from './JsonViewer';

const PEGA_COOKIES = ['Pega-AAT', 'Pega-Perf', 'Pega-RULES', 'Pega-ThreadName', 'Pega-UI-SessId'];

/** Small chevron shown next to the active sort column, pointing in the active direction. Renders nothing for inactive columns. */
const SortIndicator: React.FC<{
  field: string;
  sortField: string;
  sortDirection: 'asc' | 'desc';
}> = ({ field, sortField, sortDirection }) => {
  if (sortField !== field) return null;
  return sortDirection === 'asc'
    ? <ChevronUpIcon className="inline h-3 w-3 ml-0.5 text-sky-600" />
    : <ChevronDownIcon className="inline h-3 w-3 ml-0.5 text-sky-600" />;
};

/** Segmented Pretty/Raw switch used everywhere a body is shown, so bodies can be
 * flipped back to their exact original text (e.g. to check literal whitespace,
 * or when prettyPrintBody's best-effort formatting guesses wrong). */
const PrettyRawToggle: React.FC<{ pretty: boolean; onChange: (pretty: boolean) => void }> = ({ pretty, onChange }) => (
  <div className="flex items-center bg-slate-100 rounded-full p-0.5 text-[9px] font-bold shrink-0" role="group" aria-label="Formatting">
    <button
      onClick={() => onChange(true)}
      className={`px-2 py-0.5 rounded-full transition-colors ${pretty ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
      title="Pretty-print JSON / form bodies"
    >
      Pretty
    </button>
    <button
      onClick={() => onChange(false)}
      className={`px-2 py-0.5 rounded-full transition-colors ${!pretty ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
      title="Show the exact original text"
    >
      Raw
    </button>
  </div>
);

interface HarAnalyzerProps {
  onSendToDecoder?: (data: any) => void;
  /** Navigates to the Flow Visualizer pre-loaded with a real, HAR-reconstructed login flow. */
  onViewFlow?: (flow: DetectedFlow) => void;
}

const HarAnalyzer: React.FC<HarAnalyzerProps> = ({ onSendToDecoder, onViewFlow }) => {
  const [harData, setHarData] = useState<HarRoot | null>(null);
  const [savedHars, setSavedHars] = useState<HarMetadata[]>([]);
  const [currentHarId, setCurrentHarId] = usePersistentState<string | null>('har-current-id', null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadHars = async () => {
        try {
            const metadata = await getHarMetadataFromDB();
            if (metadata) {
                setSavedHars(metadata);
                // Load the last used one or the first one
                const idToLoad = currentHarId || metadata[0]?.id;
                if (idToLoad) {
                    const data = await getHarFromDB(idToLoad);
                    setHarData(data);
                    if (!currentHarId) setCurrentHarId(idToLoad);
                }
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsLoading(false);
        }
    };
    loadHars();
  }, []);

  const [searchQuery, setSearchQuery] = usePersistentState('har-search-query', '');
  const [selectedEntry, setSelectedEntry] = useState<HarEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = usePersistentState<string[]>('har-active-types', []);
  const [activeStatuses, setActiveStatuses] = usePersistentState<string[]>('har-active-statuses', []);
  const [sortField, setSortField] = useState<keyof HarEntry | 'name' | 'size'>('startedDateTime');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Clicking a header toggles direction if it's already the active column,
  // otherwise switches to that column (ascending). This replaces the old
  // "always just changes the field" behavior, which had no way to tell what
  // was active or to get back to chronological order.
  const handleSort = (field: keyof HarEntry | 'name' | 'size') => {
    setSortField(prevField => {
      if (prevField === field) {
        setSortDirection(prevDir => (prevDir === 'asc' ? 'desc' : 'asc'));
        return prevField;
      }
      setSortDirection('asc');
      return field;
    });
  };

  const isDefaultSort = sortField === 'startedDateTime' && sortDirection === 'asc';
  const resetSort = () => {
    setSortField('startedDateTime');
    setSortDirection('asc');
  };
  const [activeTab, setActiveTab] = useState<'headers' | 'payload' | 'response' | 'cookies'>('headers');
  const [prettyPrintContent, setPrettyPrintContent] = useState<{ title: string, body: string } | null>(null);
  const [prettyPrint, setPrettyPrint] = usePersistentState<boolean>('har-pretty-print', true);
  const [modalPrettyPrint, setModalPrettyPrint] = usePersistentState<boolean>('har-modal-pretty-print', true);
  const [expandedCookieIndex, setExpandedCookieIndex] = useState<number | null>(null);
  const [expandedHeaderIndex, setExpandedHeaderIndex] = useState<number | null>(null);
  
  useEffect(() => {
    setExpandedCookieIndex(null);
    setExpandedHeaderIndex(null);
  }, [selectedEntry, activeTab]);

  const resourceTypes = ['xhr', 'document', 'script', 'stylesheet', 'image', 'font'];
  const statusRanges = ['2xx', '3xx', '4xx', '5xx'];

  const toggleType = (type: string) => {
    setActiveTypes(prev => 
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const toggleStatus = (status: string) => {
    setActiveStatuses(prev => 
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    );
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = parseHarFile(content);
        const newId = await saveHarToDB(parsed, file.name);
        
        setHarData(parsed);
        setCurrentHarId(newId);
        
        // Refresh metadata
        const metadata = await getHarMetadataFromDB();
        if (metadata) setSavedHars(metadata);
        
        setError(null);
        setSelectedEntry(null);
      } catch (err: any) {
        console.error('HAR Parsing Error:', err);
        setError(err.message || 'Failed to parse HAR file.');
        setHarData(null);
      } finally {
        setIsLoading(false);
      }
    };
    reader.onerror = () => {
        setError('Error reading file');
        setIsLoading(false);
    }
    reader.readAsText(file);
  };

  const switchHar = async (id: string) => {
    setIsLoading(true);
    try {
        const data = await getHarFromDB(id);
        setHarData(data);
        setCurrentHarId(id);
        setSelectedEntry(null);
    } catch (err) {
        setError('Failed to load HAR');
    } finally {
        setIsLoading(false);
    }
  };

  const deleteHar = async (id: string) => {
    await deleteHarFromDB(id);
    const metadata = await getHarMetadataFromDB() || [];
    setSavedHars(metadata);
    if (currentHarId === id) {
        if (metadata.length > 0) switchHar(metadata[0].id);
        else setHarData(null);
    }
  };

  const clearAllHars = async () => {
    await clearHarFromDB();
    setSavedHars([]);
    setHarData(null);
    setCurrentHarId(null);
    setSelectedEntry(null);
  };

  const filteredEntries = useMemo(() => {
    if (!harData) return [];
    let entries = filterEntries(harData.log.entries, searchQuery, activeTypes, activeStatuses);
    
    // Sorting
    return [...entries].sort((a, b) => {
      let valA: any, valB: any;
      if (sortField === 'name') {
        valA = a.request.url.split('/').pop() || a.request.url;
        valB = b.request.url.split('/').pop() || b.request.url;
      } else if (sortField === 'size') {
        valA = a.response.content.size || 0;
        valB = b.response.content.size || 0;
      } else {
        valA = a[sortField as keyof HarEntry];
        valB = b[sortField as keyof HarEntry];
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [harData, searchQuery, activeTypes, activeStatuses, sortField, sortDirection]);

  // Fixed chronological (capture-order) index per entry, independent of the
  // current sort column. Used for the "#" column so the user always has a
  // stable reference back to the original waterfall order, no matter what
  // the table is currently sorted by.
  const orderIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    if (!harData) return map;
    const chronological = [...harData.log.entries].sort(
      (a, b) => new Date(a.startedDateTime).getTime() - new Date(b.startedDateTime).getTime()
    );
    chronological.forEach((e, i) => map.set(e._id, i + 1));
    return map;
  }, [harData]);

  const stats = useMemo(() => {
    if (!harData) return null;
    const entries = harData.log.entries;
    const totalSize = entries.reduce((acc, e) => acc + (e.response.content.size || 0), 0);
    const totalTime = entries.reduce((acc, e) => acc + e.time, 0);
    const errors = entries.filter(e => e.response.status >= 400).length;
    return {
      count: entries.length,
      size: (totalSize / 1024).toFixed(2) + ' KB',
      avgTime: (totalTime / entries.length).toFixed(0) + ' ms',
      errors
    };
  }, [harData]);

  // HAR-to-Flow Reconstruction (see enhancement-har-flow-reconstruction.md).
  // detectFlows() is async (SAML decoding may need DecompressionStream), so
  // this is state-driven rather than a useMemo.
  const [detectedFlows, setDetectedFlows] = useState<DetectedFlow[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!harData) {
      setDetectedFlows([]);
      return;
    }
    detectFlows(harData).then(flows => {
      if (!cancelled) setDetectedFlows(flows);
    });
    return () => { cancelled = true; };
  }, [harData]);

  const hasUnreconstructedSaml = useMemo(() => {
    if (!harData) return false;
    if (!hasUnreconstructedSamlTraffic(harData)) return false;
    // Only show the "not fully reconstructed" note if SAML traffic exists
    // but didn't actually produce a SAML DetectedFlow (e.g. parse failure,
    // or the ACS POST landed on a host we didn't recognize as Pega).
    return !detectedFlows.some(f => f.kind === 'saml');
  }, [harData, detectedFlows]);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const getStatusColor = (status: number) => {
    if (status >= 200 && status < 300) return 'text-emerald-600';
    if (status >= 300 && status < 400) return 'text-amber-600';
    if (status >= 400) return 'text-rose-600';
    return 'text-slate-600';
  };

  const getStatusPillStyles = (status: number) => {
    if (status >= 200 && status < 300) return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    if (status >= 300 && status < 400) return 'bg-amber-100 text-amber-700 border-amber-200';
    if (status >= 400) return 'bg-rose-100 text-rose-700 border-rose-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getName = (url: string) => {
    try {
      const u = new URL(url);
      const pathname = u.pathname;
      const parts = pathname.split('/');
      const file = parts[parts.length - 1] || u.host;
      // Include the query string so params (e.g. state/code/RelayState) are
      // visible instead of being silently dropped before they reach the DOM.
      return file + u.search;
    } catch {
      return url.split('/').pop() || url;
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] space-y-4">
      {!harData ? (
        <div className="flex-1 flex items-center justify-center">
            <div className="bg-white rounded-2xl shadow-sm border-2 border-dashed border-slate-200 p-12 text-center max-w-md w-full">
                <div className="bg-sky-50 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-sky-100 shadow-sm">
                <UploadIcon className="h-8 w-8 text-sky-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-800 mb-2">Upload HAR File</h3>
                <p className="text-slate-500 mb-8">
                Select or drag and drop a .har file exported from your browser's DevTools to analyze its contents locally.
                </p>
                <label className="inline-flex items-center px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-xl transition-all shadow-md hover:shadow-lg cursor-pointer">
                <span>Choose File</span>
                <input type="file" accept=".har,.json" className="hidden" onChange={handleFileUpload} />
                </label>
                {error && <p className="mt-4 text-rose-500 text-sm font-medium">{error}</p>}
            </div>
        </div>
      ) : (
        <>
            {/* SSO Flow Detection Banner (HAR-to-Flow Reconstruction) */}
            {(detectedFlows.length > 0 || hasUnreconstructedSaml) && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 space-y-2 shrink-0">
                    {detectedFlows.length > 0 && (
                        <div className="space-y-2">
                            <p className="text-xs font-bold text-indigo-800 uppercase tracking-wider">
                                🔗 {detectedFlows.length} SSO {detectedFlows.length === 1 ? 'flow' : 'flows'} detected
                            </p>
                            {detectedFlows.map(flow => (
                                <div key={flow.id} className="flex items-center justify-between gap-3 bg-white rounded-lg border border-indigo-100 px-3 py-2">
                                    <div className="text-xs text-indigo-900">
                                        <span className="font-bold">{flow.kind === 'oauth-oidc' ? 'OAuth2/OIDC' : flow.kind === 'saml' ? 'SAML' : 'Device'} login</span>
                                        {' '}via <span className="font-bold">{flow.idpDisplayName}</span> → Pega, started{' '}
                                        <span className="font-mono">{new Date(flow.startedAt).toLocaleTimeString()}</span>
                                    </div>
                                    {onViewFlow && (
                                        <button
                                            onClick={() => onViewFlow(flow)}
                                            className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold rounded-lg transition-colors"
                                        >
                                            View in Flow Visualizer
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {hasUnreconstructedSaml && (
                        <p className="text-[11px] text-indigo-700 italic">
                            SAML traffic was also detected in this HAR, but it couldn't be fully correlated into a step-by-step flow (e.g. the response landed on an unrecognized host, or the payload failed to parse).
                        </p>
                    )}
                </div>
            )}

            {/* Stats Dashboard */}
            <div className="grid grid-cols-4 gap-4">
                {[
                    { label: 'Requests', value: stats?.count, icon: SearchIcon, color: 'text-sky-600', bg: 'bg-sky-50' },
                    { label: 'Data Transferred', value: stats?.size, icon: DownloadIcon, color: 'text-indigo-600', bg: 'bg-indigo-50' },
                    { label: 'Avg Latency', value: stats?.avgTime, icon: ActivityIcon, color: 'text-amber-600', bg: 'bg-amber-50' },
                    { label: 'Errors', value: stats?.errors, icon: AlertTriangleIcon, color: 'text-rose-600', bg: 'bg-rose-50' },
                ].map((stat, i) => (
                    <div key={i} className="bg-white p-4 rounded-xl border border-slate-200 flex items-center space-x-4 shadow-sm">
                        <div className={`${stat.bg} ${stat.color} p-2 rounded-lg`}>
                            <stat.icon className="h-5 w-5" />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{stat.label}</p>
                            <p className="text-lg font-bold text-slate-800">{stat.value}</p>
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex-1 flex gap-4 min-h-0">
                {/* Table View */}
                <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden transition-all duration-300 ${selectedEntry ? 'w-2/5' : 'w-full'}`}>
                    <div className="p-4 border-b border-slate-100 space-y-3 bg-slate-50/50">
                        <div className="flex items-center space-x-2">
                            <div className="relative flex-1">
                                <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                <input
                                    type="text"
                                    placeholder="Filter by URL, body, or header..."
                                    className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs shadow-sm focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 outline-none transition-all"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                />
                            </div>
                            <div className="flex items-center bg-white border border-slate-200 rounded-xl px-2 shadow-sm">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-2 ml-1">Recent:</span>
                                <select 
                                    className="bg-transparent py-2 text-xs font-semibold text-slate-600 outline-none focus:ring-0 min-w-[120px]"
                                    value={currentHarId || ''}
                                    onChange={(e) => switchHar(e.target.value)}
                                >
                                    {savedHars.map(h => (
                                        <option key={h.id} value={h.id}>{h.name}</option>
                                    ))}
                                    {savedHars.length === 0 && <option value="">No HARs saved</option>}
                                </select>
                                {currentHarId && (
                                    <button 
                                        onClick={() => deleteHar(currentHarId)}
                                        className="p-1.5 text-slate-400 hover:text-rose-500 transition-colors"
                                        title="Delete this HAR"
                                    >
                                        <TrashIcon className="h-4 w-4" />
                                    </button>
                                )}
                            </div>
                            <button
                                onClick={resetSort}
                                disabled={isDefaultSort}
                                className={`p-2 rounded-xl transition-all border shadow-sm ${
                                    isDefaultSort
                                    ? 'text-slate-300 border-slate-200 bg-white cursor-default'
                                    : 'text-sky-600 border-sky-200 bg-sky-50 hover:bg-sky-100'
                                }`}
                                title="Restore chronological (capture) order"
                            >
                                <RefreshIcon className="h-5 w-5" />
                            </button>
                            <label className="p-2 text-slate-400 hover:text-sky-600 hover:bg-sky-50 rounded-xl transition-all border border-slate-200 bg-white shadow-sm cursor-pointer" title="Upload New HAR">
                                <UploadIcon className="h-5 w-5" />
                                <input type="file" accept=".har,.json" className="hidden" onChange={handleFileUpload} />
                            </label>
                            <button 
                                onClick={clearAllHars}
                                className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all border border-slate-200 bg-white shadow-sm"
                                title="Clear All History"
                            >
                                <RefreshIcon className="h-5 w-5" />
                            </button>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mr-1">Toggles:</span>
                            {resourceTypes.map(type => (
                                <button
                                    key={type}
                                    onClick={() => toggleType(type)}
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase transition-all shadow-sm border ${
                                        activeTypes.includes(type)
                                        ? 'bg-sky-600 text-white border-sky-600'
                                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                    }`}
                                >
                                    {type}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto custom-scrollbar">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                                <tr>
                                    <th
                                        className="px-3 py-2 font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none w-10"
                                        onClick={() => handleSort('startedDateTime')}
                                        title="Sort by chronological capture order"
                                    >
                                        # <SortIndicator field="startedDateTime" sortField={sortField} sortDirection={sortDirection} />
                                    </th>
                                    <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort('name')}>
                                        Name <SortIndicator field="name" sortField={sortField} sortDirection={sortDirection} />
                                    </th>
                                    <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort('response')}>
                                        Status <SortIndicator field="response" sortField={sortField} sortDirection={sortDirection} />
                                    </th>
                                    <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort('time')}>
                                        Time <SortIndicator field="time" sortField={sortField} sortDirection={sortDirection} />
                                    </th>
                                    <th className="px-3 py-2 font-bold text-slate-500 uppercase tracking-wider cursor-pointer hover:bg-slate-100 select-none" onClick={() => handleSort('size')}>
                                        Size <SortIndicator field="size" sortField={sortField} sortDirection={sortDirection} />
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredEntries.map((entry) => (
                                    <tr 
                                        key={entry._id}
                                        onClick={() => setSelectedEntry(entry)}
                                        className={`group cursor-pointer border-b border-slate-50 hover:bg-sky-50/30 transition-colors ${
                                            selectedEntry?._id === entry._id ? 'bg-sky-50 outline outline-1 outline-sky-200 z-[1]' : ''
                                        } ${entry.analysis?.hasErrors ? 'bg-rose-50/30' : ''}`}
                                    >
                                        <td className="px-3 py-2 font-mono text-slate-400 w-10">
                                            {orderIndexMap.get(entry._id) ?? '–'}
                                        </td>
                                        <td className="px-3 py-2 max-w-[200px]">
                                            <div className="flex items-center space-x-2">
                                                {entry.analysis?.authType && (
                                                    <span className="px-1 py-0.5 bg-indigo-100 text-indigo-700 text-[8px] font-bold rounded uppercase">
                                                        {entry.analysis.authType}
                                                    </span>
                                                )}
                                                <span className="font-mono truncate" title={entry.request.url}>{getName(entry.request.url)}</span>
                                            </div>
                                        </td>
                                        <td className={`px-3 py-2 font-bold ${getStatusColor(entry.response.status)}`}>
                                            {entry.response.status}
                                        </td>
                                        <td className={`px-3 py-2 font-mono ${entry.analysis?.isSlow ? 'text-amber-600 font-bold' : 'text-slate-500'}`}>
                                            {entry.time.toFixed(0)}ms
                                        </td>
                                        <td className={`px-3 py-2 font-mono ${entry.analysis?.isLarge ? 'text-amber-600 font-bold' : 'text-slate-500'}`}>
                                            {formatSize(entry.response.content.size || 0)}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Details Panel */}
                {selectedEntry && (
                    <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col overflow-hidden animate-in slide-in-from-right-4 duration-300">
                        <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-start">
                           <div className="flex-1 min-w-0 pr-4">
                               <h3 className="text-xs font-bold text-slate-800 break-all font-mono mb-1">
                                    {selectedEntry.request.url}
                                </h3>
                                <div className="flex items-center space-x-3 text-[10px]">
                                    <span className="font-bold px-1.5 py-0.5 bg-slate-200 rounded text-slate-700">{selectedEntry.request.method}</span>
                                    <span className={`font-bold px-1.5 py-0.5 rounded border ${getStatusPillStyles(selectedEntry.response.status)}`}>
                                        {selectedEntry.response.status} {selectedEntry.response.statusText}
                                    </span>
                                    <span className="text-slate-400">{selectedEntry.startedDateTime}</span>
                                </div>
                           </div>
                           <button onClick={() => setSelectedEntry(null)} className="p-1 hover:bg-slate-200 rounded">
                               <RefreshIcon className="h-4 w-4 text-slate-400 rotate-45" />
                           </button>
                        </div>

                        <div className="flex border-b border-slate-100 bg-slate-50/30 px-4 shrink-0">
                            {[
                                { id: 'headers', label: 'Headers' },
                                { id: 'payload', label: 'Payload', active: !!(selectedEntry.request.postData || selectedEntry.request.queryString.length > 0) },
                                { id: 'response', label: 'Response', active: !!selectedEntry.response.content.text },
                                { id: 'cookies', label: 'Cookies', count: selectedEntry.request.cookies.length + selectedEntry.response.cookies.length }
                            ].map((tab) => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as any)}
                                    className={`relative px-4 py-3 text-[11px] font-black uppercase tracking-widest transition-all ${
                                        activeTab === tab.id 
                                        ? 'text-sky-600 border-b-2 border-sky-600 bg-white' 
                                        : 'text-slate-400 hover:text-slate-600 hover:bg-white/50'
                                    }`}
                                >
                                    <div className="flex items-center space-x-2">
                                        <span>{tab.label}</span>
                                        {tab.active && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />}
                                        {tab.count !== undefined && <span className={`px-1 rounded ${activeTab === tab.id ? 'bg-sky-100 text-sky-700' : 'bg-slate-200 text-slate-500'} text-[9px]`}>{tab.count}</span>}
                                    </div>
                                </button>
                            ))}
                        </div>

                        <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-white">
                            {activeTab === 'headers' && (
                                <div className="space-y-6 animate-in fade-in duration-300">
                                    <section>
                                        <div className="bg-slate-50 rounded-lg border border-slate-100 overflow-hidden text-[11px]">
                                            <div className="p-2 bg-slate-100/50 font-bold text-slate-500 border-b border-slate-100">General</div>
                                            <div className="p-2 space-y-1 font-mono">
                                                <div className="flex"><span className="text-sky-700 font-bold min-w-[100px]">Request URL:</span> <span className="text-slate-600 break-all">{selectedEntry.request.url}</span></div>
                                                <div className="flex"><span className="text-sky-700 font-bold min-w-[100px]">Method:</span> <span className="text-slate-600">{selectedEntry.request.method}</span></div>
                                                <div className="flex"><span className="text-sky-700 font-bold min-w-[100px]">Status:</span> <span className={`${getStatusColor(selectedEntry.response.status)}`}>{selectedEntry.response.status}</span></div>
                                            </div>
                                            <div className="p-2 bg-slate-100/50 font-bold text-slate-500 border-y border-slate-100">Response Headers</div>
                                            <div className="p-2 space-y-1 font-mono">
                                                {selectedEntry.response.headers.map((h, i) => (
                                                    <div key={i} className="flex"><span className="text-sky-700 font-bold min-w-[140px] shrink-0">{h.name}:</span> <span className="text-slate-600 break-all">{h.value}</span></div>
                                                ))}
                                            </div>
                                            <div className="p-2 bg-slate-100/50 font-bold text-slate-500 border-y border-slate-100">Request Headers</div>
                                            <div className="p-2 space-y-1 font-mono">
                                                {selectedEntry.request.headers.map((h, i) => {
                                                    const cleanValue = h.value.replace('Bearer ', '');
                                                    const decodedJwt = jwtService.decode(cleanValue);
                                                    const isExpanded = expandedHeaderIndex === i;
                                                    
                                                    return (
                                                        <div key={i} className="border-b border-slate-100/50">
                                                            <div 
                                                                className={`p-2 flex items-start gap-2 hover:bg-white/50 transition-colors cursor-pointer group ${isExpanded ? 'bg-white/80' : ''}`}
                                                                onClick={() => {
                                                                    if (decodedJwt) setExpandedHeaderIndex(isExpanded ? null : i);
                                                                }}
                                                            >
                                                                <span className="text-sky-700 font-bold min-w-[140px] shrink-0 border-r border-slate-200 pr-2">{h.name}:</span> 
                                                                <span className="text-slate-600 break-all flex-1">{h.value}</span>
                                                                {decodedJwt && (
                                                                    <div className="flex items-center space-x-1">
                                                                        <span className={`text-[8px] ${isExpanded ? 'bg-sky-600' : 'bg-sky-500'} text-white px-1.5 py-0.5 rounded uppercase font-extrabold tracking-tighter`}>
                                                                            JWT
                                                                        </span>
                                                                        <ChevronDownIcon className={`h-3 w-3 text-sky-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                                                    </div>
                                                                )}
                                                                {(h.name.toLowerCase().includes('token') || h.value.startsWith('Bearer ')) && onSendToDecoder && (
                                                                    <button 
                                                                        onClick={(e) => { e.stopPropagation(); onSendToDecoder({ token: cleanValue, key: '' }); }}
                                                                        className="opacity-0 group-hover:opacity-100 px-1.5 py-0.5 bg-sky-100 text-sky-700 rounded-[4px] text-[8px] font-bold"
                                                                    >Full Decoder</button>
                                                                )}
                                                            </div>
                                                            {isExpanded && decodedJwt && (
                                                                <div className="p-3 bg-white border-x border-slate-200 animate-in slide-in-from-top-2 duration-200">
                                                                     <div className="bg-slate-900 rounded-xl overflow-hidden shadow-lg border border-slate-800">
                                                                        <div className="px-3 py-1.5 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                                                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Decoded {h.name}</span>
                                                                            <button 
                                                                                onClick={(e) => { e.stopPropagation(); handleCopy(JSON.stringify(decodedJwt.payload, null, 2), `h-dec-${i}`); }}
                                                                                className="text-[8px] font-bold text-slate-500 hover:text-sky-400"
                                                                            >Copy JSON</button>
                                                                        </div>
                                                                        <div className="p-1">
                                                                            <JsonViewer data={decodedJwt.payload} />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            )}

                            {activeTab === 'payload' && (
                                <div className="space-y-6 animate-in fade-in duration-300">
                                     {selectedEntry.request.postData ? (
                                        <section>
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Request Body ({selectedEntry.request.postData.mimeType})</h4>
                                                <div className="flex items-center gap-2">
                                                    <PrettyRawToggle pretty={prettyPrint} onChange={setPrettyPrint} />
                                                    <button 
                                                        onClick={() => setPrettyPrintContent({ title: 'Request Body', body: selectedEntry.request.postData?.text || '' })}
                                                        className="px-2 py-0.5 bg-slate-100 text-slate-600 hover:bg-sky-100 hover:text-sky-700 rounded text-[9px] font-bold transition-colors"
                                                    >
                                                        Open in Modal
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="bg-slate-900 rounded-lg p-3 text-[11px] font-mono text-emerald-400 whitespace-pre-wrap break-all leading-relaxed max-h-[65vh] min-h-[160px] overflow-y-auto border border-slate-800">
                                                {prettyPrint ? prettyPrintBody(selectedEntry.request.postData.text) : selectedEntry.request.postData.text}
                                            </div>
                                        </section>
                                    ) : (
                                        <div className="p-8 text-center text-slate-400 italic text-xs">No request body provided</div>
                                    )}

                                    {selectedEntry.request.queryString.length > 0 && (
                                        <section>
                                            <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Query Parameters</h4>
                                            <div className="bg-slate-50 rounded-lg border border-slate-100 p-2 space-y-1 font-mono text-[11px]">
                                                {selectedEntry.request.queryString.map((p, i) => (
                                                    <div key={i} className="flex gap-2">
                                                        <span className="text-indigo-700 font-bold min-w-[100px] shrink-0">{p.name}:</span>
                                                        <span className="text-slate-600 break-all">{p.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </section>
                                    )}
                                </div>
                            )}

                            {activeTab === 'response' && (
                                <div className="space-y-6 animate-in fade-in duration-300">
                                    {selectedEntry.response.content.text ? (
                                        <section>
                                            <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center space-x-2">
                                                    <h4 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Response Body</h4>
                                                    <span className="text-[9px] text-slate-400 font-mono italic">({selectedEntry.response.content.mimeType})</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <PrettyRawToggle pretty={prettyPrint} onChange={setPrettyPrint} />
                                                    <button 
                                                        onClick={() => setPrettyPrintContent({ title: 'Response Body', body: selectedEntry.response.content.text || '' })}
                                                        className="px-2 py-0.5 bg-slate-100 text-slate-600 hover:bg-sky-100 hover:text-sky-700 rounded text-[9px] font-bold transition-colors"
                                                    >
                                                        Open in Modal
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="bg-slate-900 rounded-lg p-3 text-[11px] font-mono text-sky-400 whitespace-pre-wrap break-all leading-relaxed max-h-[65vh] min-h-[160px] overflow-y-auto border border-slate-800">
                                                {prettyPrint ? prettyPrintBody(selectedEntry.response.content.text) : selectedEntry.response.content.text}
                                            </div>
                                        </section>
                                    ) : (
                                        <div className="p-8 text-center text-slate-400 italic text-xs">No response content available</div>
                                    )}
                                </div>
                            )}

                            {activeTab === 'cookies' && (
                                <div className="space-y-6 animate-in fade-in duration-300">
                                    <section className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                        <div className="px-3 py-2.5 bg-slate-100/50 flex justify-between items-center border-b border-slate-200">
                                            <h4 className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">Cookie Diagnostics</h4>
                                            <span className="text-[8px] text-slate-400 italic">Click value to copy</span>
                                        </div>
                                        <div className="divide-y divide-slate-100">
                                            {[...selectedEntry.request.cookies, ...selectedEntry.response.cookies].length > 0 ? (
                                                [...selectedEntry.request.cookies, ...selectedEntry.response.cookies].map((cookie, i) => {
                                                    const isPega = PEGA_COOKIES.some(p => cookie.name.toLowerCase().includes(p.toLowerCase()));
                                                    const decodedJwt = jwtService.decode(cookie.value);
                                                    const isExpanded = expandedCookieIndex === i;

                                                    return (
                                                        <div key={i} className="border-b border-white">
                                                            <div 
                                                                className={`p-2.5 flex items-start gap-2 hover:bg-white transition-colors cursor-pointer group ${isExpanded ? 'bg-white' : ''}`} 
                                                                onClick={() => {
                                                                    if (decodedJwt) setExpandedCookieIndex(isExpanded ? null : i);
                                                                    else handleCopy(cookie.value, `c-${i}`);
                                                                }}
                                                            >
                                                                <div className={`shrink-0 w-1.5 h-1.5 rounded-full mt-1.5 ${isPega ? 'bg-indigo-500 animate-pulse outline outline-4 outline-indigo-50' : 'bg-slate-300'}`} />
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center gap-2 mb-0.5">
                                                                        <span className={`font-bold text-[11px] ${isPega ? 'text-indigo-700' : 'text-slate-700'}`}>{cookie.name}</span>
                                                                        {isPega && <span className="text-[8px] bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded uppercase font-extrabold tracking-tighter">Pega</span>}
                                                                        {decodedJwt && (
                                                                            <span className={`text-[8px] ${isExpanded ? 'bg-sky-600 text-white' : 'bg-sky-100 text-sky-700'} px-1.5 py-0.5 rounded uppercase font-extrabold tracking-tighter flex items-center`}>
                                                                                <DetailIcon className="h-2 w-2 mr-1" />
                                                                                {isExpanded ? 'Hide Decoded' : 'Click to Decode'}
                                                                            </span>
                                                                        )}
                                                                        {copied === `c-${i}` && <span className="text-[8px] text-emerald-600 font-bold ml-auto flex items-center bg-emerald-50 px-1 rounded"><CheckIcon className="h-2 w-2 mr-0.5" /> Copied</span>}
                                                                    </div>
                                                                    <div className={`text-[10px] font-mono text-slate-500 break-all ${isExpanded ? '' : 'line-clamp-2 group-hover:line-clamp-none'} transition-all`}>
                                                                        {cookie.value}
                                                                    </div>
                                                                </div>
                                                                {decodedJwt && (
                                                                    <div className={`mt-1.5 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}>
                                                                        <ChevronDownIcon className="h-3.5 w-3.5 text-sky-500" />
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {isExpanded && decodedJwt && (
                                                                <div className="px-4 pb-4 bg-white animate-in slide-in-from-top-2 duration-200">
                                                                    <div className="bg-slate-900 rounded-xl overflow-hidden shadow-inner border border-slate-800">
                                                                        <div className="px-3 py-1.5 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                                                                            <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Decoded {cookie.name}</span>
                                                                            <div className="flex space-x-2">
                                                                                <button 
                                                                                    onClick={(e) => { e.stopPropagation(); handleCopy(JSON.stringify(decodedJwt.payload, null, 2), `c-dec-${i}`); }}
                                                                                    className="text-[8px] font-bold text-slate-500 hover:text-sky-400 transition-colors"
                                                                                >Copy JSON</button>
                                                                            </div>
                                                                        </div>
                                                                        <div className="p-1">
                                                                            <JsonViewer data={decodedJwt.payload} />
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                            ) : (
                                                <div className="p-8 text-center text-slate-400 italic text-[11px]">No cookies found in this request</div>
                                            )}
                                        </div>
                                    </section>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </>
      )}

      <div className="bg-sky-50 border border-sky-100 rounded-xl p-3 flex items-start space-x-3 shrink-0">
        <div className="bg-sky-100 p-1.5 rounded-lg">
          <InfoIcon className="h-4 w-4 text-sky-600" />
        </div>
        <div className="text-[11px] text-sky-800">
          <p className="font-bold mb-0.5 leading-none">Pro Tip - Deep Search & Diagnostics</p>
          <p className="opacity-80">
            Use the search bar to find keywords inside JSON bodies or headers. Requests marked in <span className="text-rose-600 font-bold">pink</span> failed, and <span className="text-amber-600 font-bold">bold time/size</span> indicates outliers.
          </p>
        </div>
      </div>

      {/* Pretty Print Modal */}
      {prettyPrintContent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md animate-in fade-in duration-300">
              <div className="bg-white rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-white/20 w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-300">
                  <div className="px-6 py-4 border-b border-slate-100 bg-white flex justify-between items-center shrink-0">
                        <div className="flex items-center space-x-3">
                            <div className="w-2 h-2 rounded-full bg-sky-500 animate-pulse" />
                            <h3 className="text-xs font-black text-slate-800 uppercase tracking-[0.2em]">{prettyPrintContent.title}</h3>
                        </div>
                        <div className="flex items-center space-x-2">
                            <PrettyRawToggle pretty={modalPrettyPrint} onChange={setModalPrettyPrint} />
                            <button 
                                onClick={() => handleCopy(prettyPrintContent.body, 'modal')}
                                className="flex items-center space-x-2 px-3 py-1.5 text-[11px] font-bold text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-full transition-all border border-slate-100 hover:border-sky-200"
                            >
                                {copied === 'modal' ? <CheckIcon className="h-3.5 w-3.5 text-emerald-500" /> : <ClipboardIcon className="h-3.5 w-3.5" />}
                                <span>{copied === 'modal' ? 'Copied' : 'Copy All'}</span>
                            </button>
                            <div className="w-px h-4 bg-slate-200 mx-1" />
                            <button 
                                onClick={() => setPrettyPrintContent(null)}
                                className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-full transition-all"
                            >
                                <XIcon className="h-5 w-5" />
                            </button>
                        </div>
                  </div>
                  <div className="flex-1 overflow-auto bg-slate-950 selection:bg-sky-500/30">
                      <div className="p-8">
                          <pre className="text-[13px] font-mono text-sky-400/90 leading-relaxed whitespace-pre-wrap break-words [tab-size:4]">
                              {modalPrettyPrint ? prettyPrintBody(prettyPrintContent.body) : prettyPrintContent.body}
                          </pre>
                      </div>
                  </div>
                  <div className="px-6 py-3 border-t border-slate-50 bg-slate-50/50 flex justify-between items-center shrink-0">
                      <p className="text-[10px] text-slate-400 font-medium tracking-tight">
                          <span className="text-slate-500 font-bold">Pro Tip:</span> Use browser search (Ctrl+F) to filter this content.
                      </p>
                      <button 
                          onClick={() => setPrettyPrintContent(null)}
                          className="text-[10px] font-bold text-slate-400 hover:text-slate-600 uppercase tracking-widest transition-colors"
                      >
                          Close Esc
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default HarAnalyzer;
