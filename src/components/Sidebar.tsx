
import React from 'react';
import { 
  ShieldCheckIcon, 
  FileCodeIcon, 
  LockClosedIcon, 
  KeyIcon, 
  ShuffleIcon, 
  ServerIcon, 
  SearchIcon, 
  ScaleIcon, 
  RefreshIcon, 
  InfoIcon,
  CertificateIcon,
  UsersIcon,
  ArrowRightIcon,
  BookmarkIcon,
  SearchIcon as DetailIcon,
  MonitorIcon,
  LogOutIcon,
  AlertTriangleIcon
} from './icons';

export enum AppView {
  DECODE = 'Decode',
  ENCODE = 'Encode',
  SAML = 'SAML',
  KEYS = 'Keys',
  SIMULATE = 'Simulate',
  FLOWS = 'Flows',
  PKCE = 'PKCE',
  DIFF = 'Diff',
  CONVERT = 'Convert',
  SECRETS = 'Secrets',
  SCOPES = 'Scopes',
  LEARN = 'Learn',
  BASE64 = 'Base64',
  URL = 'URL',
  HASH = 'Hashing',
  HMAC = 'HMAC',
  SUBNET = 'Subnet Calculator',
  PASSWORD = 'Password Analyzer',
  UUID = 'UUID Generator',
  CRON = 'Cron Parser',
  HAR_ANALYZER = 'HAR Analyzer',
  COLLECTIONS = 'My Collections',
  OIDC_DISCOVERY = 'OIDC Discovery',
  OIDC_USERINFO = 'OIDC UserInfo',
  OIDC_VALIDATOR = 'ID Token Validator',
  OIDC_ASSERTION = 'Assertion Generator',
  XSW_SIMULATOR = 'XSW Simulator',
  DEVICE_FLOW = 'Device Flow',
  LOGOUT_EXPLORER = 'Logout Explorer',
  TOKEN_TESTER = 'Token Tester'
}

interface SidebarProps {
  activeView: AppView;
  setActiveView: (view: AppView) => void;
}

interface Category {
  name: string;
  items: {
    id: AppView;
    label: string;
    icon: React.FC<{ className?: string }>;
  }[];
}

const categories: Category[] = [
    {
    name: 'Data Tools',
    items: [
      { id: AppView.HAR_ANALYZER, label: 'HAR Analyzer', icon: DetailIcon },      
      { id: AppView.KEYS, label: 'Key Manager', icon: KeyIcon },
      { id: AppView.BASE64, label: 'Base64 Converter', icon: LockClosedIcon },      
    ],
  },
  {
    name: 'JWT & OAuth Tools',
    items: [
      { id: AppView.DECODE, label: 'JWT Decoder', icon: SearchIcon },
      { id: AppView.ENCODE, label: 'JWT Encoder', icon: FileCodeIcon },
      { id: AppView.DIFF, label: 'Token Diff', icon: ScaleIcon },
      { id: AppView.PKCE, label: 'PKCE Generator', icon: RefreshIcon },
      { id: AppView.TOKEN_TESTER, label: 'Token Tester', icon: ServerIcon },
    ],
  },
  {
    name: 'SAML Tools',
    items: [
      { id: AppView.SAML, label: 'SAML Tools', icon: CertificateIcon },
    ],
  },
  {
    name: 'OIDC Tools',
    items: [
      { id: AppView.OIDC_DISCOVERY, label: 'Discovery Explorer', icon: SearchIcon },
      { id: AppView.OIDC_USERINFO, label: 'UserInfo Fetcher', icon: UsersIcon },
      { id: AppView.OIDC_VALIDATOR, label: 'ID Token Validator', icon: ShieldCheckIcon },
      { id: AppView.OIDC_ASSERTION, label: 'Assertion Generator', icon: KeyIcon },
    ],
  },
  {
    name: 'IT Tools',
    items: [
      { id: AppView.SUBNET, label: 'Subnet Calc', icon: ServerIcon },
      { id: AppView.CRON, label: 'Cron Parser', icon: RefreshIcon },
      { id: AppView.SECRETS, label: 'Secret Generator', icon: LockClosedIcon },
      { id: AppView.URL, label: 'URL Tool', icon: ArrowRightIcon },
      { id: AppView.HASH, label: 'Hashing Tool', icon: KeyIcon },
      { id: AppView.HMAC, label: 'HMAC Tool', icon: ShieldCheckIcon },
      { id: AppView.UUID, label: 'UUID Generator', icon: RefreshIcon },
      { id: AppView.PASSWORD, label: 'Password Analyzer', icon: ShieldCheckIcon },
      { id: AppView.CONVERT, label: 'Format Converter', icon: RefreshIcon },
    ],
  },
    {
    name: 'Educational',
    items: [
      { id: AppView.FLOWS, label: 'Flow Visualizer', icon: ShuffleIcon },
      { id: AppView.XSW_SIMULATOR, label: 'XSW Simulator', icon: AlertTriangleIcon },
      { id: AppView.DEVICE_FLOW, label: 'Device Flow', icon: MonitorIcon },
      { id: AppView.LOGOUT_EXPLORER, label: 'Logout Explorer', icon: LogOutIcon },
      { id: AppView.SIMULATE, label: 'Failure Simulator', icon: ShieldCheckIcon },
      { id: AppView.LEARN, label: 'Learn Flows', icon: InfoIcon },
      { id: AppView.SCOPES, label: 'Scope Explorer', icon: UsersIcon },
    ],
  },
    {
    name: 'Saved',
    items: [
      { id: AppView.COLLECTIONS, label: 'Collections', icon: BookmarkIcon },
    ],
  },
];

const Sidebar: React.FC<SidebarProps> = ({ activeView, setActiveView }) => {
  return (
    <div className="w-64 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b border-slate-100">
        <div className="flex items-center space-x-3">
          <div className="bg-sky-50 p-2 rounded-lg shadow-sm border border-sky-100">
            <ShieldCheckIcon className="h-6 w-6 text-sky-600" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight leading-none">
              Security Tribe
            </h2>
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider mt-1">Toolkit</p>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar">
        {categories.map((category) => (
          <div key={category.name}>
            <h3 className="px-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
              {category.name}
            </h3>
            <div className="mt-2 space-y-1">
              {category.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveView(item.id)}
                  className={`w-full flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    activeView === item.id
                      ? 'bg-sky-50 text-sky-700'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <item.icon className={`mr-3 h-5 w-5 ${
                    activeView === item.id ? 'text-sky-600' : 'text-slate-400'
                  }`} />
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>
      

    </div>
  );
};

export default Sidebar;
