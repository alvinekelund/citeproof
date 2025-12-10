/**
 * PDF Text Mapping System
 * Builds a mapping between PDF pages and text content positions
 * Enables navigation from claims to the correct PDF page
 */

import * as pdfjsLib from 'pdfjs-dist';
import { normalizeText, getFirstNWords, getLastNWords, stringSimilarity } from './text-anchors';

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
}

/**
 * Extract detailed text regions from a PDF page
 * Returns positioned text items for precise highlighting
 */
export async function extractPageTextRegions(
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  viewport: pdfjsLib.PageViewport
): Promise<TextRegion[]> {
  const page = await pdfDoc.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const regions: TextRegion[] = [];

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
    });
  }

  return regions;
}

/**
 * Find text regions on a page that match a search string
 * Uses word-level matching with tolerance for line breaks
 */
export function findMatchingRegions(
  regions: TextRegion[],
  searchText: string,
  startWordCount: number = 6,
  endWordCount: number = 4
): TextRegion[] {
  if (regions.length === 0) return [];

  const normalizedSearch = normalizeText(searchText);
  const searchWords = normalizedSearch.split(/\s+/);
  
  // Get matching phrases
  const firstWords = searchWords.slice(0, startWordCount).join(' ');
  const lastWords = searchWords.slice(-endWordCount).join(' ');

  // Build running text from regions to find matches
  let runningText = '';
  let startIndex = -1;
  let endIndex = -1;
  const matchedRegions: TextRegion[] = [];

  for (let i = 0; i < regions.length; i++) {
    const regionText = normalizeText(regions[i].text);
    runningText += (runningText ? ' ' : '') + regionText;

    // Check for start match
    if (startIndex === -1 && runningText.includes(firstWords)) {
      startIndex = Math.max(0, i - startWordCount);
    }

    // Check for end match after we've found the start
    if (startIndex !== -1 && runningText.includes(lastWords)) {
      endIndex = i;
      break;
    }

    // Prevent running text from growing too large
    if (runningText.length > 2000) {
      if (startIndex === -1) {
        runningText = runningText.slice(-500);
      }
    }
  }

  // If we found a match range, collect those regions
  if (startIndex !== -1) {
    const actualEnd = endIndex !== -1 ? endIndex : Math.min(startIndex + 50, regions.length - 1);
    for (let i = startIndex; i <= actualEnd; i++) {
      matchedRegions.push(regions[i]);
    }
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
  for (const [y, lineRegions] of lineGroups) {
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
