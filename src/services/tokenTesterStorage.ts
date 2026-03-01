const DB_NAME = 'SecurityTribeToolkitDB';
const STORE_NAME = 'token-tester';
const DB_VERSION = 4;

export interface TokenTesterState {
  url: string;
  method: string;
  headers: { key: string; value: string }[];
  authType: 'none' | 'basic' | 'bearer';
  basicAuth?: { user: string; pass: string };
  bearerToken?: string;
  bodyType: 'json' | 'form';
  body: string;
}

export const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error('IndexedDB error:', event);
      reject('Error opening database');
    };

    request.onsuccess = (event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      if (!db.objectStoreNames.contains('har-file')) {
        db.createObjectStore('har-file');
      }
      if (!db.objectStoreNames.contains('token-diff')) {
        db.createObjectStore('token-diff');
      }
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      if (!db.objectStoreNames.contains('jwt-encoder')) {
        db.createObjectStore('jwt-encoder');
      }
      if (!db.objectStoreNames.contains('jwt-decoder')) {
        db.createObjectStore('jwt-decoder');
      }
    };
  });
};

export const saveTokenTesterState = async (state: TokenTesterState): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(state, 'current-state');

    request.onsuccess = () => resolve();
    request.onerror = () => reject('Error saving token tester state');
  });
};

export const getTokenTesterState = async (): Promise<TokenTesterState | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get('current-state');

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject('Error reading token tester state');
  });
};
