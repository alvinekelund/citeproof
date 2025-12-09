// Client-side storage using IndexedDB for files and localStorage for data
import type { Source, ThesisDocument, ThesisParagraph, ParagraphCheck, CheckResult, CitationStyle } from "./types";

const DB_NAME = 'thesis-checker-db';
const DB_VERSION = 1;
const FILES_STORE = 'files';

// IndexedDB for file storage
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: 'path' });
      }
    };
  });
}

export async function storeFile(path: string, file: File): Promise<void> {
  const db = await openDB();
  const arrayBuffer = await file.arrayBuffer();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const store = tx.objectStore(FILES_STORE);
    
    const request = store.put({
      path,
      name: file.name,
      type: file.type,
      data: arrayBuffer,
      createdAt: new Date().toISOString(),
    });
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getFile(path: string): Promise<File | null> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readonly');
    const store = tx.objectStore(FILES_STORE);
    const request = store.get(path);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const result = request.result;
      if (!result) {
        resolve(null);
        return;
      }
      
      const blob = new Blob([result.data], { type: result.type });
      const file = new File([blob], result.name, { type: result.type });
      resolve(file);
    };
  });
}

export async function deleteFile(path: string): Promise<void> {
  const db = await openDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(FILES_STORE, 'readwrite');
    const store = tx.objectStore(FILES_STORE);
    const request = store.delete(path);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export function getFileUrl(path: string): string {
  // Return a special URL that we'll intercept
  return `indexeddb://${path}`;
}

// Helper to generate UUIDs
function generateId(): string {
  return crypto.randomUUID();
}

// LocalStorage helpers
function getStorageItem<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setStorageItem<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

// Sources
const SOURCES_KEY = 'thesis-checker-sources';

export function getSources(): Source[] {
  return getStorageItem<Source[]>(SOURCES_KEY, []);
}

export function createSource(source: Omit<Source, 'id' | 'created_at' | 'updated_at'>): Source {
  const sources = getSources();
  
  // Check for duplicate by original_filename
  const existingIndex = sources.findIndex(s => s.original_filename === source.original_filename);
  if (existingIndex !== -1) {
    // Update existing instead of creating duplicate
    const updated: Source = {
      ...sources[existingIndex],
      ...source,
      updated_at: new Date().toISOString(),
    };
    sources[existingIndex] = updated;
    setStorageItem(SOURCES_KEY, sources);
    return updated;
  }
  
  const newSource: Source = {
    ...source,
    id: generateId(),
    citation_style: source.citation_style || 'apa7',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  sources.unshift(newSource);
  setStorageItem(SOURCES_KEY, sources);
  return newSource;
}

export function updateSource(id: string, updates: Partial<Source>): Source {
  const sources = getSources();
  const index = sources.findIndex(s => s.id === id);
  if (index === -1) throw new Error('Source not found');
  
  sources[index] = {
    ...sources[index],
    ...updates,
    updated_at: new Date().toISOString(),
  };
  setStorageItem(SOURCES_KEY, sources);
  return sources[index];
}

export function deleteSource(id: string): void {
  const sources = getSources();
  const filtered = sources.filter(s => s.id !== id);
  setStorageItem(SOURCES_KEY, filtered);
}

// Thesis documents
const DOCS_KEY = 'thesis-checker-documents';
const PARAGRAPHS_KEY = 'thesis-checker-paragraphs';

export function getThesisDocuments(): ThesisDocument[] {
  return getStorageItem<ThesisDocument[]>(DOCS_KEY, []);
}

export function createThesisDocument(doc: Omit<ThesisDocument, 'id' | 'created_at'>): ThesisDocument {
  const docs = getThesisDocuments();
  const newDoc: ThesisDocument = {
    ...doc,
    id: generateId(),
    created_at: new Date().toISOString(),
  };
  docs.unshift(newDoc);
  setStorageItem(DOCS_KEY, docs);
  return newDoc;
}

export function updateThesisDocument(id: string, updates: Partial<ThesisDocument>): void {
  const docs = getThesisDocuments();
  const index = docs.findIndex(d => d.id === id);
  if (index !== -1) {
    docs[index] = { ...docs[index], ...updates };
    setStorageItem(DOCS_KEY, docs);
  }
}

// Paragraphs
export function getThesisParagraphs(docId: string): ThesisParagraph[] {
  const all = getStorageItem<ThesisParagraph[]>(PARAGRAPHS_KEY, []);
  return all.filter(p => p.thesis_document_id === docId).sort((a, b) => a.index - b.index);
}

export function getThesisParagraph(docId: string, index: number): ThesisParagraph | null {
  const paragraphs = getThesisParagraphs(docId);
  return paragraphs.find(p => p.index === index) || null;
}

export function createThesisParagraphs(paragraphs: Omit<ThesisParagraph, 'id' | 'created_at'>[]): void {
  const all = getStorageItem<ThesisParagraph[]>(PARAGRAPHS_KEY, []);
  const newParagraphs = paragraphs.map(p => ({
    ...p,
    id: generateId(),
    created_at: new Date().toISOString(),
  }));
  setStorageItem(PARAGRAPHS_KEY, [...all, ...newParagraphs]);
}

// Paragraph checks (history)
const CHECKS_KEY = 'thesis-checker-checks';

export function getParagraphChecks(): ParagraphCheck[] {
  const checks = getStorageItem<ParagraphCheck[]>(CHECKS_KEY, []);
  // Add thesis_paragraph_index for display
  return checks.map(check => {
    if (check.thesis_paragraph_id) {
      const allParagraphs = getStorageItem<ThesisParagraph[]>(PARAGRAPHS_KEY, []);
      const paragraph = allParagraphs.find(p => p.id === check.thesis_paragraph_id);
      return { ...check, thesis_paragraph_index: paragraph?.index };
    }
    return check;
  });
}

export function getParagraphCheck(id: string): ParagraphCheck | null {
  const checks = getParagraphChecks();
  return checks.find(c => c.id === id) || null;
}

export function createParagraphCheck(check: {
  thesis_paragraph_id?: string;
  raw_paragraph_text: string;
  result_json: CheckResult;
  overall_color: 'green' | 'yellow' | 'red' | 'blue';
}): ParagraphCheck {
  const checks = getStorageItem<ParagraphCheck[]>(CHECKS_KEY, []);
  const newCheck: ParagraphCheck = {
    ...check,
    id: generateId(),
    created_at: new Date().toISOString(),
  };
  checks.unshift(newCheck);
  setStorageItem(CHECKS_KEY, checks);
  return newCheck;
}

// File upload helper
export async function uploadFile(file: File, folder: string): Promise<string> {
  const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const filePath = `${folder}/${filename}`;
  await storeFile(filePath, file);
  return filePath;
}

// Download source file
export async function downloadSourceFile(filePath: string): Promise<File | null> {
  return await getFile(filePath);
}

// Generate shorthand ID from filename
export function generateShorthandId(filename: string): string {
  const name = filename
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .slice(0, 2)
    .join('_');
  
  const year = new Date().getFullYear();
  return `${name}_${year}`;
}

// Open file from IndexedDB - downloads the file since blob URLs get blocked in iframes
export async function openFileInNewTab(filePath: string): Promise<boolean> {
  try {
    const file = await getFile(filePath);
    if (file) {
      const url = URL.createObjectURL(file);
      
      // Use download approach since window.open with blob URLs gets blocked in iframes
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      // Clean up after a delay
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return true;
    }
    console.error('File not found in IndexedDB:', filePath);
    return false;
  } catch (error) {
    console.error('Error opening file:', error);
    return false;
  }
}
