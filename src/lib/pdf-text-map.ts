/**
 * PDF Text Mapping System
 * Builds a mapping between PDF pages and text content positions
 * Enables navigation from claims to the correct PDF page
 */

import * as pdfjsLib from 'pdfjs-dist';
import { normalizeText, stringSimilarity } from './text-anchors';

export interface PdfPageInfo {
  pageNumber: number;
  startOffset: number;
  endOffset: number;
  text: string;
  normalizedText: string;
}

export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  pageNumber: number;
}

export interface PdfTextMap {
  pages: PdfPageInfo[];
  fullText: string;
  totalPages: number;
}

/**
 * Extract text from all pages of a PDF and build a page-to-offset map
 */
export async function buildPdfTextMap(pdfDoc: pdfjsLib.PDFDocumentProxy): Promise<PdfTextMap> {
  const pages: PdfPageInfo[] = [];
  let fullText = '';
  let currentOffset = 0;

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();
    
    // Build page text from items
    const pageText = textContent.items
      .filter((item: any) => item.str && item.str.trim())
      .map((item: any) => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    const startOffset = currentOffset;
    const endOffset = currentOffset + pageText.length;

    pages.push({
      pageNumber: pageNum,
      startOffset,
      endOffset,
      text: pageText,
      normalizedText: normalizeText(pageText),
    });

    fullText += (fullText ? ' ' : '') + pageText;
    currentOffset = endOffset + 1; // +1 for space between pages
  }

  return {
    pages,
    fullText,
    totalPages: pdfDoc.numPages,
  };
}

/**
 * Find which PDF page contains text at the given character offset
 */
export function findPageForOffset(textMap: PdfTextMap, offset: number): number {
  for (const page of textMap.pages) {
    if (offset >= page.startOffset && offset < page.endOffset) {
      return page.pageNumber;
    }
  }
  // Default to first page if offset not found
  return 1;
}

/**
 * Find which PDF page(s) contain the given text using fuzzy matching
 */
export function findPagesForText(
  textMap: PdfTextMap,
  searchText: string,
  minSimilarity: number = 0.5
): number[] {
  const normalizedSearch = normalizeText(searchText);
  const searchWords = normalizedSearch.split(/\s+/);
  const matchedPages: { page: number; score: number }[] = [];

  // Get key phrases for matching
  const firstWords = searchWords.slice(0, 8).join(' ');
  const lastWords = searchWords.slice(-5).join(' ');

  for (const page of textMap.pages) {
    let score = 0;

    // Check for first words match
    if (page.normalizedText.includes(firstWords)) {
      score += 0.6;
    }

    // Check for last words match
    if (page.normalizedText.includes(lastWords)) {
      score += 0.4;
    }

    // If no word matches, check for partial overlap
    if (score === 0) {
      const pageWords = new Set(page.normalizedText.split(/\s+/));
      const matchedWordCount = searchWords.filter(w => pageWords.has(w)).length;
      const overlapRatio = matchedWordCount / searchWords.length;
      
      if (overlapRatio > 0.3) {
        score = overlapRatio * 0.5;
      }
    }

    if (score >= minSimilarity) {
      matchedPages.push({ page: page.pageNumber, score });
    }
  }

  // Sort by score descending and return page numbers
  return matchedPages
    .sort((a, b) => b.score - a.score)
    .map(m => m.page);
}

/**
 * Find the best matching page for a paragraph text
 */
export function findBestPageForParagraph(
  textMap: PdfTextMap,
  paragraphText: string
): number {
  const pages = findPagesForText(textMap, paragraphText, 0.3);
  return pages[0] || 1;
}

export interface TextRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  charStart?: number; // Character offset in concatenated page text
  charEnd?: number;
}

/**
 * Extract detailed text regions from a PDF page with character offsets
 */
export async function extractPageTextRegions(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  viewport: pdfjsLib.PageViewport
): Promise<TextRegion[]> {
  const page = await pdfDoc.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const regions: TextRegion[] = [];
  let charOffset = 0;

  for (const item of textContent.items as any[]) {
    if (!item.str || !item.str.trim()) continue;

    const transform = item.transform;
    const x = transform[4];
    const y = transform[5];
    const fontSize = transform[0] || 12;
    const width = item.width || (item.str.length * fontSize * 0.5);
    const height = fontSize * 1.2;

    // Convert PDF coordinates to canvas coordinates
    const [a, b, c, d, e, f] = viewport.transform;
    const canvasX = a * x + c * y + e;
    const canvasY = b * x + d * y + f;

    regions.push({
      x: canvasX,
      y: canvasY - height, // Adjust for text baseline
      width,
      height: height + 2,
      text: item.str,
      charStart: charOffset,
      charEnd: charOffset + item.str.length,
    });

    charOffset += item.str.length + 1; // +1 for space
  }

  return regions;
}

/**
 * Build concatenated page text from regions
 */
export function buildPageTextFromRegions(regions: TextRegion[]): string {
  return regions.map(r => r.text).join(' ');
}

/**
 * Find the character range where searchText best matches within pageText
 * Uses multiple strategies for precise character-level matching
 */
export function findTextRange(
  pageText: string,
  searchText: string,
  minSimilarity: number = 0.5
): { start: number; end: number; similarity: number } | null {
  const normalizedPage = normalizeText(pageText).toLowerCase();
  const normalizedSearch = normalizeText(searchText).toLowerCase();
  
  if (normalizedSearch.length < 10) return null;
  
  // Strategy 1: Try exact substring match
  const exactIndex = normalizedPage.indexOf(normalizedSearch);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + normalizedSearch.length, similarity: 1.0 };
  }
  
  // Strategy 2: Find longest common substring at the start
  // This handles minor OCR/encoding differences
  const searchLen = normalizedSearch.length;
  
  // Try matching first N characters directly (sliding window for start)
  for (const startLen of [50, 40, 30, 20, 15]) {
    if (searchLen < startLen) continue;
    
    const searchStart = normalizedSearch.slice(0, startLen);
    const startIdx = normalizedPage.indexOf(searchStart);
    
    if (startIdx !== -1) {
      // Found the start - now determine where it ends
      // Use the search text length as a guide, with some tolerance
      const expectedEnd = startIdx + searchLen;
      const endIdx = Math.min(normalizedPage.length, expectedEnd + Math.floor(searchLen * 0.1));
      
      return { 
        start: startIdx, 
        end: Math.min(endIdx, startIdx + searchLen + 20), // Cap expansion
        similarity: 0.9 
      };
    }
  }
  
  // Strategy 3: Word-based matching with strict length constraints
  const searchWords = normalizedSearch.split(/\s+/);
  const pageWords = normalizedPage.split(/\s+/);
  
  if (searchWords.length >= 5) {
    // Find first 3-4 words
    const firstPhrase = searchWords.slice(0, 4).join(' ');
    const firstIdx = normalizedPage.indexOf(firstPhrase);
    
    if (firstIdx !== -1) {
      // Constrain end to approximately the right length
      const charEstimate = normalizedSearch.length;
      const endIdx = Math.min(normalizedPage.length, firstIdx + charEstimate + 30);
      
      return { start: firstIdx, end: endIdx, similarity: 0.85 };
    }
  }
  
  return null;
}

// Fuzzy word match for OCR tolerance
function fuzzyWordMatch(word1: string, word2: string, threshold: number = 0.7): boolean {
  if (word1 === word2) return true;
  if (Math.abs(word1.length - word2.length) > 3) return false;
  
  const maxLen = Math.max(word1.length, word2.length);
  if (maxLen === 0) return true;
  
  // Simple Levenshtein for short words
  if (maxLen <= 10) {
    const matrix: number[][] = [];
    for (let i = 0; i <= word2.length; i++) matrix[i] = [i];
    for (let j = 0; j <= word1.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= word2.length; i++) {
      for (let j = 1; j <= word1.length; j++) {
        matrix[i][j] = word2[i - 1] === word1[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
      }
    }
    const dist = matrix[word2.length][word1.length];
    return (1 - dist / maxLen) >= threshold;
  }
  
  // For longer words, check prefix/suffix
  const prefixLen = Math.min(5, Math.floor(maxLen * 0.4));
  return word1.slice(0, prefixLen) === word2.slice(0, prefixLen) ||
         word1.slice(-prefixLen) === word2.slice(-prefixLen);
}

// Check if phrase matches in text with fuzzy word matching
function fuzzyPhraseMatch(text: string, phrase: string, tolerance: number = 0.7): boolean {
  const textWords = text.split(/\s+/);
  const phraseWords = phrase.split(/\s+/);
  
  if (phraseWords.length === 0) return false;
  if (textWords.length < phraseWords.length) return false;
  
  // Try to find the phrase in the text with fuzzy word matching
  for (let i = 0; i <= textWords.length - phraseWords.length; i++) {
    let matches = 0;
    for (let j = 0; j < phraseWords.length; j++) {
      if (fuzzyWordMatch(textWords[i + j], phraseWords[j], tolerance)) {
        matches++;
      }
    }
    // Require 70% of words to match
    if (matches >= phraseWords.length * 0.7) return true;
  }
  return false;
}

/**
 * Find text regions that match a search string using word-level matching
 * Uses first/last words with fuzzy matching for OCR tolerance
 */
export function findMatchingRegions(
  regions: TextRegion[],
  searchText: string,
  _startWordCount: number = 6,
  _endWordCount: number = 4
): TextRegion[] {
  if (regions.length === 0 || !searchText || searchText.length < 20) return [];

  const normalizedSearch = normalizeText(searchText).toLowerCase();
  const searchWords = normalizedSearch.split(/\s+/).filter(w => w.length > 0);
  
  if (searchWords.length < 3) return [];
  
  // Get first and last distinctive phrases
  const firstPhrase = searchWords.slice(0, Math.min(5, searchWords.length)).join(' ');
  const lastPhrase = searchWords.slice(-Math.min(4, searchWords.length)).join(' ');
  
  // Build normalized text for each region
  const regionData = regions.map((region, idx) => ({
    region,
    idx,
    normalizedText: normalizeText(region.text).toLowerCase(),
  }));
  
  // Find start region: look for first phrase with fuzzy matching
  let startIdx = -1;
  for (let i = 0; i < regionData.length; i++) {
    // Build running text from this position
    let runningText = '';
    for (let j = i; j < Math.min(i + 12, regionData.length); j++) {
      runningText += (runningText ? ' ' : '') + regionData[j].normalizedText;
      if (runningText.length > firstPhrase.length + 30) break;
    }
    
    // Try exact match first, then fuzzy
    if (runningText.includes(firstPhrase) || fuzzyPhraseMatch(runningText, firstPhrase)) {
      startIdx = i;
      break;
    }
  }
  
  // Try shorter prefix if not found
  if (startIdx === -1) {
    const shortPrefix = searchWords.slice(0, 3).join(' ');
    for (let i = 0; i < regionData.length; i++) {
      let runningText = '';
      for (let j = i; j < Math.min(i + 8, regionData.length); j++) {
        runningText += (runningText ? ' ' : '') + regionData[j].normalizedText;
      }
      if (runningText.includes(shortPrefix) || fuzzyPhraseMatch(runningText, shortPrefix)) {
        startIdx = i;
        break;
      }
    }
  }
  
  if (startIdx === -1) return [];
  
  // Find end region by searching for last phrase
  const estimatedRegionCount = Math.ceil(searchWords.length / 2);
  const maxEndIdx = Math.min(startIdx + estimatedRegionCount + 15, regionData.length);
  
  let endIdx = -1;
  for (let i = maxEndIdx - 1; i >= startIdx; i--) {
    // Build running text backwards
    let runningText = '';
    for (let j = i; j >= Math.max(i - 8, startIdx); j--) {
      runningText = regionData[j].normalizedText + (runningText ? ' ' : '') + runningText;
      if (runningText.length > lastPhrase.length + 30) break;
    }
    
    if (runningText.includes(lastPhrase) || fuzzyPhraseMatch(runningText, lastPhrase)) {
      endIdx = i;
      break;
    }
  }
  
  // Fallback: estimate end based on character/word count
  if (endIdx === -1 || endIdx < startIdx) {
    let wordCount = 0;
    for (let i = startIdx; i < regionData.length; i++) {
      wordCount += regionData[i].normalizedText.split(/\s+/).length;
      if (wordCount >= searchWords.length) {
        endIdx = i;
        break;
      }
    }
    if (endIdx === -1) endIdx = Math.min(startIdx + 10, regionData.length - 1);
  }
  
  // Return regions from start to end (inclusive)
  return regions.slice(startIdx, endIdx + 1);
}

/**
 * Find regions matching a specific claim within already-matched paragraph regions
 * Uses word-level matching for precise highlighting
 */
export function findClaimRegions(
  paragraphRegions: TextRegion[],
  claimText: string
): TextRegion[] {
  if (paragraphRegions.length === 0 || !claimText || claimText.length < 10) {
    return [];
  }
  
  const normalizedClaim = normalizeText(claimText).toLowerCase();
  const claimWords = normalizedClaim.split(/\s+/).filter(w => w.length > 0);
  
  if (claimWords.length < 2) return [];
  
  // Get first and last phrases of the claim
  const firstPhrase = claimWords.slice(0, Math.min(4, claimWords.length)).join(' ');
  const lastPhrase = claimWords.slice(-Math.min(3, claimWords.length)).join(' ');
  
  // Build normalized text for each region
  const regionData = paragraphRegions.map((region, idx) => ({
    region,
    idx,
    normalizedText: normalizeText(region.text).toLowerCase(),
  }));
  
  // Find start region with fuzzy matching
  let startIdx = -1;
  for (let i = 0; i < regionData.length; i++) {
    let runningText = '';
    for (let j = i; j < Math.min(i + 8, regionData.length); j++) {
      runningText += (runningText ? ' ' : '') + regionData[j].normalizedText;
      if (runningText.length > firstPhrase.length + 20) break;
    }
    
    if (runningText.includes(firstPhrase) || fuzzyPhraseMatch(runningText, firstPhrase)) {
      startIdx = i;
      break;
    }
  }
  
  // Try shorter prefix with fuzzy matching
  if (startIdx === -1 && claimWords.length > 2) {
    const shortPrefix = claimWords.slice(0, 2).join(' ');
    for (let i = 0; i < regionData.length; i++) {
      let runningText = '';
      for (let j = i; j < Math.min(i + 6, regionData.length); j++) {
        runningText += (runningText ? ' ' : '') + regionData[j].normalizedText;
      }
      if (runningText.includes(shortPrefix) || fuzzyPhraseMatch(runningText, shortPrefix, 0.8)) {
        startIdx = i;
        break;
      }
    }
  }
  
  if (startIdx === -1) return [];
  
  // Find end region with fuzzy matching
  const estimatedRegionCount = Math.ceil(claimWords.length / 2);
  const maxEndIdx = Math.min(startIdx + estimatedRegionCount + 10, regionData.length);
  
  let endIdx = -1;
  for (let i = maxEndIdx - 1; i >= startIdx; i--) {
    let runningText = '';
    for (let j = i; j >= Math.max(i - 6, startIdx); j--) {
      runningText = regionData[j].normalizedText + (runningText ? ' ' : '') + runningText;
      if (runningText.length > lastPhrase.length + 20) break;
    }
    
    if (runningText.includes(lastPhrase) || fuzzyPhraseMatch(runningText, lastPhrase)) {
      endIdx = i;
      break;
    }
  }
  
  // Fallback based on word count
  if (endIdx === -1 || endIdx < startIdx) {
    let wordCount = 0;
    for (let i = startIdx; i < regionData.length; i++) {
      wordCount += regionData[i].normalizedText.split(/\s+/).length;
      if (wordCount >= claimWords.length) {
        endIdx = i;
        break;
      }
    }
    if (endIdx === -1) endIdx = Math.min(startIdx + 6, regionData.length - 1);
  }
  
  return paragraphRegions.slice(startIdx, endIdx + 1);
}

/**
 * Merge adjacent text regions into bounding boxes
 * Groups regions by line (similar Y position)
 */
export function mergeRegionsIntoBoxes(regions: TextRegion[]): TextRegion[] {
  if (regions.length === 0) return [];

  // Group by Y position (same line)
  const lineGroups: Map<number, TextRegion[]> = new Map();
  const lineThreshold = 5; // Pixels

  for (const region of regions) {
    const roundedY = Math.round(region.y / lineThreshold) * lineThreshold;
    const existing = lineGroups.get(roundedY) || [];
    existing.push(region);
    lineGroups.set(roundedY, existing);
  }

  // Merge each line into a single box
  const boxes: TextRegion[] = [];
  for (const [_, lineRegions] of lineGroups) {
    const sortedByX = lineRegions.sort((a, b) => a.x - b.x);
    
    let minX = Infinity;
    let maxX = 0;
    let maxHeight = 0;
    const texts: string[] = [];

    for (const region of sortedByX) {
      minX = Math.min(minX, region.x);
      maxX = Math.max(maxX, region.x + region.width);
      maxHeight = Math.max(maxHeight, region.height);
      texts.push(region.text);
    }

    boxes.push({
      x: minX,
      y: sortedByX[0].y,
      width: maxX - minX,
      height: maxHeight,
      text: texts.join(' '),
    });
  }

  return boxes;
}

/**
 * Calculate overall bounding box for a set of regions
 */
export function getBoundingBox(regions: TextRegion[]): TextRegion | null {
  if (regions.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;

  for (const region of regions) {
    minX = Math.min(minX, region.x);
    minY = Math.min(minY, region.y);
    maxX = Math.max(maxX, region.x + region.width);
    maxY = Math.max(maxY, region.y + region.height);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    text: regions.map(r => r.text).join(' '),
  };
}
