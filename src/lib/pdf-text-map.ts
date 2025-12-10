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
 * Uses sliding window with fuzzy matching for robustness
 */
export function findTextRange(
  pageText: string,
  searchText: string,
  minSimilarity: number = 0.6
): { start: number; end: number; similarity: number } | null {
  const normalizedPage = normalizeText(pageText);
  const normalizedSearch = normalizeText(searchText);
  
  if (normalizedSearch.length < 10) return null;
  
  // Try exact substring match first
  const exactIndex = normalizedPage.indexOf(normalizedSearch);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + normalizedSearch.length, similarity: 1.0 };
  }
  
  // Try matching first few words to find approximate start
  const searchWords = normalizedSearch.split(/\s+/);
  const firstPhrase = searchWords.slice(0, Math.min(6, searchWords.length)).join(' ');
  const lastPhrase = searchWords.slice(-Math.min(4, searchWords.length)).join(' ');
  
  let bestMatch: { start: number; end: number; similarity: number } | null = null;
  
  // Find where first phrase appears
  let searchStart = 0;
  while (searchStart < normalizedPage.length) {
    const firstIdx = normalizedPage.indexOf(firstPhrase, searchStart);
    if (firstIdx === -1) break;
    
    // Look for last phrase after the first phrase
    const searchEndStart = firstIdx + firstPhrase.length;
    const lastIdx = normalizedPage.indexOf(lastPhrase, searchEndStart);
    
    if (lastIdx !== -1) {
      const matchEnd = lastIdx + lastPhrase.length;
      const matchedText = normalizedPage.slice(firstIdx, matchEnd);
      const similarity = stringSimilarity(matchedText, normalizedSearch);
      
      if (similarity >= minSimilarity) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { start: firstIdx, end: matchEnd, similarity };
        }
      }
    }
    
    searchStart = firstIdx + 1;
  }
  
  return bestMatch;
}

/**
 * Find text regions that match a search string using character-level matching
 * This is the core matching function - much more precise than word-based
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
  const range = findTextRange(pageText, searchText, 0.5);
  if (!range) return [];
  
  // Map character range back to regions
  const matchedRegions: TextRegion[] = [];
  let charPos = 0;
  
  for (const region of regions) {
    const regionEnd = charPos + region.text.length;
    
    // Check if this region overlaps with the matched range
    const overlapsStart = charPos < range.end;
    const overlapsEnd = regionEnd > range.start;
    
    if (overlapsStart && overlapsEnd) {
      matchedRegions.push(region);
    }
    
    charPos = regionEnd + 1; // +1 for space
  }
  
  return matchedRegions;
}

/**
 * Find regions matching a specific claim within already-matched paragraph regions
 */
export function findClaimRegions(
  paragraphRegions: TextRegion[],
  claimText: string
): TextRegion[] {
  if (paragraphRegions.length === 0 || !claimText || claimText.length < 15) {
    return paragraphRegions; // Return all paragraph regions as fallback
  }
  
  const pageText = buildPageTextFromRegions(paragraphRegions);
  const range = findTextRange(pageText, claimText, 0.5);
  
  if (!range) return []; // No match found
  
  // Map to regions
  const matchedRegions: TextRegion[] = [];
  let charPos = 0;
  
  for (const region of paragraphRegions) {
    const regionEnd = charPos + region.text.length;
    
    if (charPos < range.end && regionEnd > range.start) {
      matchedRegions.push(region);
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
