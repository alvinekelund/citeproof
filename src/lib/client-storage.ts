// Client-side storage using IndexedDB for files and large data, localStorage for small data
import type { Source, ThesisDocument, ThesisParagraph, ParagraphCheck, CheckResult, CitationStyle } from "./types";

const DB_NAME = 'thesis-checker-db';
const DB_VERSION = 4; // Bumped version for checks store
const FILES_STORE = 'files';
const TEXT_STORE = 'extracted-text';
const SESSION_TEXT_STORE = 'session-text';
const CHECKS_STORE = 'paragraph-checks'; // New store for paragraph checks

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
      // Store for extracted text (uses source ID as key)
      if (!db.objectStoreNames.contains(TEXT_STORE)) {
        db.createObjectStore(TEXT_STORE, { keyPath: 'id' });
      }
      // Store for session full text (uses session ID as key)
      if (!db.objectStoreNames.contains(SESSION_TEXT_STORE)) {
        db.createObjectStore(SESSION_TEXT_STORE, { keyPath: 'sessionId' });
      }
      // Store for paragraph checks (uses id as key)
      if (!db.objectStoreNames.contains(CHECKS_STORE)) {
        db.createObjectStore(CHECKS_STORE, { keyPath: 'id' });
      }
    };
  });
}

// ============= EXTRACTED TEXT STORAGE (IndexedDB) =============

export async function storeExtractedText(sourceId: string, text: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_STORE, 'readwrite');
    const store = tx.objectStore(TEXT_STORE);
    const request = store.put({ id: sourceId, text, updatedAt: new Date().toISOString() });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getExtractedText(sourceId: string): Promise<string | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_STORE, 'readonly');
    const store = tx.objectStore(TEXT_STORE);
    const request = store.get(sourceId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      resolve(request.result?.text || null);
    };
  });
}

export async function deleteExtractedText(sourceId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_STORE, 'readwrite');
    const store = tx.objectStore(TEXT_STORE);
    const request = store.delete(sourceId);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// Get all extracted texts for multiple sources at once
export async function getExtractedTexts(sourceIds: string[]): Promise<Map<string, string>> {
  const db = await openDB();
  const result = new Map<string, string>();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_STORE, 'readonly');
    const store = tx.objectStore(TEXT_STORE);
    let pending = sourceIds.length;
    
    if (pending === 0) {
      resolve(result);
      return;
    }
    
    for (const id of sourceIds) {
      const request = store.get(id);
      request.onerror = () => {
        pending--;
        if (pending === 0) resolve(result);
      };
      request.onsuccess = () => {
        if (request.result?.text) {
          result.set(id, request.result.text);
        }
        pending--;
        if (pending === 0) resolve(result);
      };
    }
  });
}

// ============= SESSION TEXT STORAGE (IndexedDB) =============

export async function storeSessionText(sessionId: string, text: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SESSION_TEXT_STORE, 'readwrite');
    const store = tx.objectStore(SESSION_TEXT_STORE);
    const request = store.put({ sessionId, text, updatedAt: new Date().toISOString() });
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getSessionText(sessionId: string): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_TEXT_STORE, 'readonly');
      const store = tx.objectStore(SESSION_TEXT_STORE);
      const request = store.get(sessionId);
      request.onerror = () => {
        console.error('Error getting session text:', request.error);
        resolve(null);
      };
      request.onsuccess = () => {
        resolve(request.result?.text || null);
      };
    });
  } catch (e) {
    console.error('Failed to get session text:', e);
    return null;
  }
}

export async function deleteSessionText(sessionId: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SESSION_TEXT_STORE, 'readwrite');
      const store = tx.objectStore(SESSION_TEXT_STORE);
      const request = store.delete(sessionId);
      request.onerror = () => {
        console.error('Error deleting session text:', request.error);
        resolve();
      };
      request.onsuccess = () => resolve();
    });
  } catch (e) {
    console.error('Failed to delete session text:', e);
  }
}

// ============= FILE STORAGE (IndexedDB) =============

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

// LocalStorage helpers - with error handling for quota
function getStorageItem<T>(key: string, defaultValue: T): T {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch {
    return defaultValue;
  }
}

function setStorageItem<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // Handle quota exceeded - log and continue
    console.error('localStorage quota exceeded:', e);
  }
}

// ============= SOURCES (localStorage for metadata, IndexedDB for text) =============
const SOURCES_KEY = 'thesis-checker-sources';

// Source type without the heavy extracted_text field for localStorage
interface SourceMetadata extends Omit<Source, 'extracted_text'> {
  has_extracted_text?: boolean; // Flag to indicate text is stored separately
}

export function getSources(): Source[] {
  const metadata = getStorageItem<SourceMetadata[]>(SOURCES_KEY, []);
  // Return sources without extracted_text - it will be loaded separately when needed
  return metadata.map(m => ({
    ...m,
    extracted_text: undefined, // Text is now in IndexedDB
  }));
}

// Get sources with their extracted text loaded from IndexedDB
export async function getSourcesWithText(): Promise<Source[]> {
  const metadata = getStorageItem<SourceMetadata[]>(SOURCES_KEY, []);
  const sourceIds = metadata.map(m => m.id);
  const texts = await getExtractedTexts(sourceIds);
  
  return metadata.map(m => ({
    ...m,
    extracted_text: texts.get(m.id) || undefined,
  }));
}

// Check which sources have extracted text
export async function getSourcesTextStatus(): Promise<Map<string, boolean>> {
  const metadata = getStorageItem<SourceMetadata[]>(SOURCES_KEY, []);
  const sourceIds = metadata.map(m => m.id);
  const texts = await getExtractedTexts(sourceIds);
  
  const status = new Map<string, boolean>();
  for (const id of sourceIds) {
    status.set(id, texts.has(id) && (texts.get(id)?.length || 0) > 100);
  }
  return status;
}

export function createSource(source: Omit<Source, 'id' | 'created_at' | 'updated_at'>): Source {
  const metadata = getStorageItem<SourceMetadata[]>(SOURCES_KEY, []);
  
  // Check for duplicate by original_filename
  const existingIndex = metadata.findIndex(s => s.original_filename === source.original_filename);
  
  // Extract the text before saving metadata
  const { extracted_text, ...sourceWithoutText } = source;
  
  if (existingIndex !== -1) {
    // Update existing instead of creating duplicate
    const updated: SourceMetadata = {
      ...metadata[existingIndex],
      ...sourceWithoutText,
      has_extracted_text: !!extracted_text,
      updated_at: new Date().toISOString(),
    };
    metadata[existingIndex] = updated;
    setStorageItem(SOURCES_KEY, metadata);
    
    // Store extracted text separately in IndexedDB if provided
    if (extracted_text) {
      storeExtractedText(updated.id, extracted_text).catch(console.error);
    }
    
    return { ...updated, extracted_text };
  }
  
  const newId = generateId();
  const newSource: SourceMetadata = {
    ...sourceWithoutText,
    id: newId,
    citation_style: source.citation_style || 'apa7',
    has_extracted_text: !!extracted_text,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  metadata.unshift(newSource);
  setStorageItem(SOURCES_KEY, metadata);
  
  // Store extracted text separately in IndexedDB if provided
  if (extracted_text) {
    storeExtractedText(newId, extracted_text).catch(console.error);
  }
  
  return { ...newSource, extracted_text };
}

export function updateSource(id: string, updates: Partial<Source>): Source {
  const metadata = getStorageItem<SourceMetadata[]>(SOURCES_KEY, []);
  const index = metadata.findIndex(s => s.id === id);
  if (index === -1) throw new Error('Source not found');
  
  // Extract the text before saving metadata
  const { extracted_text, ...updatesWithoutText } = updates;
  
  metadata[index] = {
    ...metadata[index],
    ...updatesWithoutText,
    has_extracted_text: extracted_text !== undefined ? !!extracted_text : metadata[index].has_extracted_text,
    updated_at: new Date().toISOString(),
  };
  setStorageItem(SOURCES_KEY, metadata);
  
  // Store extracted text separately in IndexedDB if provided
  if (extracted_text !== undefined) {
    if (extracted_text) {
      storeExtractedText(id, extracted_text).catch(console.error);
    } else {
      deleteExtractedText(id).catch(console.error);
    }
  }
  
  return { ...metadata[index], extracted_text };
}

export function deleteSource(id: string): void {
  const metadata = getStorageItem<SourceMetadata[]>(SOURCES_KEY, []);
  const filtered = metadata.filter(s => s.id !== id);
  setStorageItem(SOURCES_KEY, filtered);
  
  // Also delete extracted text from IndexedDB
  deleteExtractedText(id).catch(console.error);
}

// ============= THESIS DOCUMENTS =============
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

// ============= PARAGRAPH CHECKS (HISTORY - IndexedDB) =============
const CHECKS_KEY = 'thesis-checker-checks'; // Legacy key for migration

// Migrate old localStorage checks to IndexedDB (run once)
async function migrateChecksToIndexedDB(): Promise<void> {
  try {
    const oldChecks = getStorageItem<ParagraphCheck[]>(CHECKS_KEY, []);
    if (oldChecks.length > 0) {
      const db = await openDB();
      const tx = db.transaction(CHECKS_STORE, 'readwrite');
      const store = tx.objectStore(CHECKS_STORE);
      
      for (const check of oldChecks) {
        store.put(check);
      }
      
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      
      // Clear localStorage after migration
      localStorage.removeItem(CHECKS_KEY);
      console.log(`Migrated ${oldChecks.length} checks to IndexedDB`);
    }
  } catch (error) {
    console.error('Failed to migrate checks:', error);
  }
}

// Run migration on module load
migrateChecksToIndexedDB();

export async function getParagraphChecksAsync(): Promise<ParagraphCheck[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKS_STORE, 'readonly');
    const store = tx.objectStore(CHECKS_STORE);
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const checks = request.result as ParagraphCheck[];
      // Sort by created_at descending (newest first)
      checks.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      resolve(checks);
    };
  });
}

// Sync version for backwards compatibility - returns empty array, use async version
export function getParagraphChecks(): ParagraphCheck[] {
  // Return empty - callers should use async version
  console.warn('getParagraphChecks is deprecated, use getParagraphChecksAsync');
  return [];
}

export async function getParagraphCheckAsync(id: string): Promise<ParagraphCheck | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKS_STORE, 'readonly');
    const store = tx.objectStore(CHECKS_STORE);
    const request = store.get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || null);
  });
}

export function getParagraphCheck(id: string): ParagraphCheck | null {
  console.warn('getParagraphCheck is deprecated, use getParagraphCheckAsync');
  return null;
}

export async function createParagraphCheckAsync(check: {
  thesis_paragraph_id?: string;
  raw_paragraph_text: string;
  result_json: CheckResult;
  overall_color: 'green' | 'yellow' | 'red' | 'blue';
}): Promise<ParagraphCheck> {
  const db = await openDB();
  const newCheck: ParagraphCheck = {
    ...check,
    id: generateId(),
    created_at: new Date().toISOString(),
  };
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(CHECKS_STORE, 'readwrite');
    const store = tx.objectStore(CHECKS_STORE);
    const request = store.put(newCheck);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(newCheck);
  });
}

// Sync version - still works but uses async internally
export function createParagraphCheck(check: {
  thesis_paragraph_id?: string;
  raw_paragraph_text: string;
  result_json: CheckResult;
  overall_color: 'green' | 'yellow' | 'red' | 'blue';
}): ParagraphCheck {
  const newCheck: ParagraphCheck = {
    ...check,
    id: generateId(),
    created_at: new Date().toISOString(),
  };
  
  // Fire and forget - store async
  (async () => {
    try {
      const db = await openDB();
      const tx = db.transaction(CHECKS_STORE, 'readwrite');
      const store = tx.objectStore(CHECKS_STORE);
      store.put(newCheck);
    } catch (error) {
      console.error('Failed to store check in IndexedDB:', error);
    }
  })();
  
  return newCheck;
}

// ============= FILE UPLOAD HELPER =============
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

// ============= PENDING CITATIONS =============
const PENDING_CITATIONS_KEY = 'thesis-checker-pending-citations';

export interface PendingCitation {
  id: string;
  label: string;        // The in-text label like "(Brynjolfsson et al., 2020)"
  author: string;       // Extracted author
  year: number | null;  // Extracted year
  count: number;        // How many times it appears
  created_at: string;
}

export function getPendingCitations(): PendingCitation[] {
  return getStorageItem<PendingCitation[]>(PENDING_CITATIONS_KEY, []);
}

export function addPendingCitation(citation: Omit<PendingCitation, 'id' | 'created_at'>): PendingCitation {
  const pending = getPendingCitations();
  
  // Check if already exists
  const existing = pending.find(p => p.label.toLowerCase() === citation.label.toLowerCase());
  if (existing) {
    return existing;
  }
  
  const newPending: PendingCitation = {
    ...citation,
    id: generateId(),
    created_at: new Date().toISOString(),
  };
  pending.push(newPending);
  setStorageItem(PENDING_CITATIONS_KEY, pending);
  return newPending;
}

export function removePendingCitation(id: string): void {
  const pending = getPendingCitations();
  const filtered = pending.filter(p => p.id !== id);
  setStorageItem(PENDING_CITATIONS_KEY, filtered);
}

export function clearPendingCitations(): void {
  setStorageItem(PENDING_CITATIONS_KEY, []);
}

export function findMatchingPendingCitation(author: string, year: number | null): PendingCitation | null {
  const pending = getPendingCitations();
  const authorLower = author.toLowerCase();
  
  // Find a pending citation that matches the author and year
  return pending.find(p => {
    const pendingAuthorLower = p.author.toLowerCase();
    const yearMatches = !p.year || !year || p.year === year;
    return pendingAuthorLower === authorLower && yearMatches;
  }) || null;
}

// ============= SESSION DATA (for citation re-analysis) =============
// NOTE: fullText is now stored in IndexedDB via storeSessionText/getSessionText
// This localStorage version is kept for backward compatibility but deprecated

const SESSION_MISSING_KEY = 'thesis-checker-session-missing';

export interface SessionMissingCitations {
  sessionId: string;
  fullText: string; // Store full text for re-analysis
}

// Get session missing data - first try IndexedDB, fallback to localStorage
export async function getSessionMissingDataAsync(sessionId: string): Promise<SessionMissingCitations | null> {
  // Try IndexedDB first
  const idbText = await getSessionText(sessionId);
  if (idbText) {
    return { sessionId, fullText: idbText };
  }
  
  // Fallback to localStorage for backward compatibility
  const all = getStorageItem<SessionMissingCitations[]>(SESSION_MISSING_KEY, []);
  const found = all.find(s => s.sessionId === sessionId);
  
  // If found in localStorage, migrate to IndexedDB
  if (found?.fullText) {
    await storeSessionText(sessionId, found.fullText).catch(console.error);
    // Remove from localStorage to free up space
    const filtered = all.filter(s => s.sessionId !== sessionId);
    setStorageItem(SESSION_MISSING_KEY, filtered);
    return found;
  }
  
  return null;
}

// Deprecated: sync version for backward compatibility
export function getSessionMissingData(sessionId: string): SessionMissingCitations | null {
  const all = getStorageItem<SessionMissingCitations[]>(SESSION_MISSING_KEY, []);
  return all.find(s => s.sessionId === sessionId) || null;
}

// Save session missing data - now stores in IndexedDB
export async function saveSessionMissingDataAsync(data: SessionMissingCitations): Promise<void> {
  await storeSessionText(data.sessionId, data.fullText);
}

// Deprecated: sync version that stores in localStorage (for very short texts only)
export function saveSessionMissingData(data: SessionMissingCitations): void {
  // Store in IndexedDB for large texts
  storeSessionText(data.sessionId, data.fullText).catch(console.error);
}

export async function deleteSessionMissingDataAsync(sessionId: string): Promise<void> {
  await deleteSessionText(sessionId);
  // Also clean up localStorage
  const all = getStorageItem<SessionMissingCitations[]>(SESSION_MISSING_KEY, []);
  setStorageItem(SESSION_MISSING_KEY, all.filter(s => s.sessionId !== sessionId));
}

export function deleteSessionMissingData(sessionId: string): void {
  deleteSessionText(sessionId).catch(console.error);
  const all = getStorageItem<SessionMissingCitations[]>(SESSION_MISSING_KEY, []);
  setStorageItem(SESSION_MISSING_KEY, all.filter(s => s.sessionId !== sessionId));
}

// ============= SESSION PDF STORAGE (IndexedDB) =============
// Store and retrieve PDF files associated with copilot sessions

export async function storeSessionPdf(sessionId: string, file: File): Promise<void> {
  console.log('[Storage] Storing session PDF:', sessionId, 'name:', file.name, 'type:', file.type, 'size:', file.size);
  const path = `session-pdf/${sessionId}`;
  await storeFile(path, file);
  console.log('[Storage] Session PDF stored successfully:', sessionId);
}

export async function getSessionPdf(sessionId: string): Promise<File | null> {
  const path = `session-pdf/${sessionId}`;
  const file = await getFile(path);
  console.log('[Storage] Getting session PDF:', sessionId, 'found:', !!file, 'name:', file?.name, 'type:', file?.type, 'size:', file?.size);
  return file;
}

export async function deleteSessionPdf(sessionId: string): Promise<void> {
  const path = `session-pdf/${sessionId}`;
  await deleteFile(path);
}
