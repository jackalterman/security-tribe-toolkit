import { HarRoot } from './har';

const DB_NAME = 'SecurityTribeToolkitDB';
const STORE_NAME = 'har-file';
const METADATA_KEY = 'har-metadata';
const DB_VERSION = 4;

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
      
      // Create har-file store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
      
      // Create token-diff store if it doesn't exist (for compatibility)
      if (!db.objectStoreNames.contains('token-diff')) {
        db.createObjectStore('token-diff');
      }

      // Create token-tester store if it doesn't exist
      if (!db.objectStoreNames.contains('token-tester')) {
        db.createObjectStore('token-tester');
      }
      
      // Create jwt-encoder store if it doesn't exist
      if (!db.objectStoreNames.contains('jwt-encoder')) {
        db.createObjectStore('jwt-encoder');
      }
      
      // Create jwt-decoder store if it doesn't exist
      if (!db.objectStoreNames.contains('jwt-decoder')) {
        db.createObjectStore('jwt-decoder');
      }
    };
  });
};

export interface HarMetadata {
  id: string;
  name: string;
  timestamp: number;
}

export const saveHarToDB = async (data: HarRoot, name: string): Promise<string> => {
  const db = await openDB();
  const id = `har-${Date.now()}`;
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // 1. Get current metadata first (within the same transaction)
    const metaGetRequest = store.get(METADATA_KEY);
    
    metaGetRequest.onsuccess = () => {
      const metadata: HarMetadata[] = metaGetRequest.result || [];
      const newEntry: HarMetadata = { id, name, timestamp: Date.now() };
      let updatedMetadata = [newEntry, ...metadata];
      
      // Keep only top 5 and delete old ones
      if (updatedMetadata.length > 5) {
        const toDelete = updatedMetadata.slice(5);
        updatedMetadata = updatedMetadata.slice(0, 5);
        for (const item of toDelete) {
          store.delete(item.id);
        }
      }
      
      // 2. Save the metadata
      store.put(updatedMetadata, METADATA_KEY);
      
      // 3. Save the HAR data
      const dataPutRequest = store.put(data, id);
      dataPutRequest.onsuccess = () => resolve(id);
      dataPutRequest.onerror = () => reject('Error saving HAR data');
    };
    
    metaGetRequest.onerror = () => reject('Error reading metadata during save');
    transaction.onerror = (e) => {
        console.error('Transaction error:', e);
        reject('Transaction failed');
    };
  });
};

export const getHarMetadataFromDB = async (): Promise<HarMetadata[] | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(METADATA_KEY);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject('Error reading HAR metadata from DB');
  });
};

export const getHarFromDB = async (id: string = 'current-har'): Promise<HarRoot | null> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => {
        resolve(request.result || null);
    };
    request.onerror = () => reject('Error reading HAR from DB');
  });
};

export const deleteHarFromDB = async (id: string): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // 1. Get current metadata (within the same transaction)
    const metaGetRequest = store.get(METADATA_KEY);
    
    metaGetRequest.onsuccess = () => {
      const metadata: HarMetadata[] = metaGetRequest.result || [];
      const updatedMetadata = metadata.filter(m => m.id !== id);
      
      // 2. Update metadata
      store.put(updatedMetadata, METADATA_KEY);
      
      // 3. Delete the HAR data
      const deleteRequest = store.delete(id);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => reject('Error deleting HAR data');
    };
    
    metaGetRequest.onerror = () => reject('Error reading metadata during delete');
    transaction.onerror = (e) => {
        console.error('Transaction error during delete:', e);
        reject('Transaction failed');
    };
  });
};

export const clearHarFromDB = async (): Promise<void> => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    // We want to clear all HARs AND metadata
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject('Error clearing HAR from DB');
  });
};
