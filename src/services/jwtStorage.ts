const DB_NAME = 'SecurityTribeToolkitDB';
const DB_VERSION = 4;

export interface JwtEncoderState {
    alg: string;
    header: string;
    payload: string;
    secret: string;
    privateKey: string;
}

export interface JwtDecoderState {
    token: string;
    key: string;
    audience: string;
    issuer: string;
}

const openDB = (): Promise<IDBDatabase> => {
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
            
            if (!db.objectStoreNames.contains('har-file')) db.createObjectStore('har-file');
            if (!db.objectStoreNames.contains('token-diff')) db.createObjectStore('token-diff');
            if (!db.objectStoreNames.contains('token-tester')) db.createObjectStore('token-tester');
            if (!db.objectStoreNames.contains('jwt-encoder')) db.createObjectStore('jwt-encoder');
            if (!db.objectStoreNames.contains('jwt-decoder')) db.createObjectStore('jwt-decoder');
        };
    });
};

export const saveJwtEncoderState = async (state: JwtEncoderState): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['jwt-encoder'], 'readwrite');
        const store = transaction.objectStore('jwt-encoder');
        const request = store.put(state, 'current-state');
        request.onsuccess = () => resolve();
        request.onerror = () => reject('Error saving encoder state');
    });
};

export const getJwtEncoderState = async (): Promise<JwtEncoderState | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['jwt-encoder'], 'readonly');
        const store = transaction.objectStore('jwt-encoder');
        const request = store.get('current-state');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject('Error reading encoder state');
    });
};

export const saveJwtDecoderState = async (state: JwtDecoderState): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['jwt-decoder'], 'readwrite');
        const store = transaction.objectStore('jwt-decoder');
        const request = store.put(state, 'current-state');
        request.onsuccess = () => resolve();
        request.onerror = () => reject('Error saving decoder state');
    });
};

export const getJwtDecoderState = async (): Promise<JwtDecoderState | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['jwt-decoder'], 'readonly');
        const store = transaction.objectStore('jwt-decoder');
        const request = store.get('current-state');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject('Error reading decoder state');
    });
};
