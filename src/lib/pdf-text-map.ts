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

/**
 * Find text regions that match a search string using precise character-level matching
 * Returns ONLY the regions that actually contain the matched text
 */
export function findMatchingRegions(
  regions: TextRegion[],
  searchText: string,
  _startWordCount: number = 6,
  _endWordCount: number = 4
): TextRegion[] {
  if (regions.length === 0 || !searchText || searchText.length < 20) return [];

  // Build page text with character tracking
  const pageText = buildPageTextFromRegions(regions);
  
  // Find the character range where the search text matches
  const range = findTextRange(pageText, searchText, 0.4);
  if (!range) return [];
  
  // Calculate expected character count for the search text
  const expectedCharCount = normalizeText(searchText).length;
  
  // Limit the range to approximately the search text length
  const constrainedEnd = Math.min(range.end, range.start + expectedCharCount + 50);
  
  // Map character range back to regions - be precise about boundaries
  const matchedRegions: TextRegion[] = [];
  let charPos = 0;
  let totalMatchedChars = 0;
  
  for (const region of regions) {
    const regionStart = charPos;
    const regionEnd = charPos + region.text.length;
    
    // Check if region overlaps with the constrained match range
    const overlapStart = Math.max(regionStart, range.start);
    const overlapEnd = Math.min(regionEnd, constrainedEnd);
    const overlapLength = Math.max(0, overlapEnd - overlapStart);
    
    if (overlapLength > 0) {
      matchedRegions.push(region);
      totalMatchedChars += region.text.length;
      
      // Stop if we've matched enough characters (with 30% buffer)
      if (totalMatchedChars > expectedCharCount * 1.3) {
        break;
      }
    }
    
    charPos = regionEnd + 1; // +1 for space
  }
  
  return matchedRegions;
}

/**
 * Find regions matching a specific claim within already-matched paragraph regions
 * Returns empty array if claim not found (no fallback to paragraph)
 */
export function findClaimRegions(
  paragraphRegions: TextRegion[],
  claimText: string
): TextRegion[] {
  if (paragraphRegions.length === 0 || !claimText || claimText.length < 10) {
    return []; // Don't return paragraph as fallback
  }
  
  const pageText = buildPageTextFromRegions(paragraphRegions);
  const normalizedClaim = normalizeText(claimText).toLowerCase();
  const normalizedPage = normalizeText(pageText).toLowerCase();
  
  // Try direct substring match first
  let startIdx = normalizedPage.indexOf(normalizedClaim);
  let endIdx = startIdx !== -1 ? startIdx + normalizedClaim.length : -1;
  
  // If not found, try first 30 chars
  if (startIdx === -1 && normalizedClaim.length > 30) {
    const prefix = normalizedClaim.slice(0, 30);
    startIdx = normalizedPage.indexOf(prefix);
    if (startIdx !== -1) {
      endIdx = Math.min(normalizedPage.length, startIdx + normalizedClaim.length + 20);
    }
  }
  
  if (startIdx === -1) return []; // No match found
  
  // Constrain to claim length
  const expectedLen = normalizedClaim.length;
  const constrainedEnd = Math.min(endIdx, startIdx + expectedLen + 30);
  
  // Map to regions with strict boundaries
  const matchedRegions: TextRegion[] = [];
  let charPos = 0;
  let totalChars = 0;
  
  for (const region of paragraphRegions) {
    const regionStart = charPos;
    const regionEnd = charPos + region.text.length;
    
    const overlapStart = Math.max(regionStart, startIdx);
    const overlapEnd = Math.min(regionEnd, constrainedEnd);
    const overlapLength = Math.max(0, overlapEnd - overlapStart);
    
    if (overlapLength > 0) {
      matchedRegions.push(region);
      totalChars += region.text.length;
      
      // Stop once we have enough
      if (totalChars > expectedLen * 1.2) break;
    }
    
    charPos = regionEnd + 1;
  }
  
  return matchedRegions;
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
