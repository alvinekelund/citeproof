/**
 * Token-Based PDF Text Mapping System
 * Indexes PDF documents at the word (token) level for precise highlighting
 * Uses DOM-based overlays instead of canvas drawing
 */

import * as pdfjsLib from 'pdfjs-dist';

// ============= Core Interfaces =============

/**
 * A single word/token in the PDF
 */
export interface PdfToken {
  id: number;           // Unique index across all pages
  text: string;         // Normalized: lowercase, trimmed, no punctuation
  rawText: string;      // The original string for display
  pageIndex: number;    // 0-based page index
  // Raw PDF coordinates (unscaled, bottom-left origin)
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * Result of a search query - locations to highlight
 */
export interface ClaimLocation {
  claimId: string;
  pageIndex: number;
  rects: PdfToken['rect'][]; // The bounding boxes to highlight
  tokens: PdfToken[];        // The actual matched tokens
}

/**
 * Page metadata for navigation
 */
export interface PdfPageMetadata {
  pageIndex: number;
  pageHeight: number;
  pageWidth: number;
  tokenCount: number;
  startTokenId: number;
  endTokenId: number;
}

// ============= Normalization Utilities =============

/**
 * Normalize text for fuzzy matching
 * Removes punctuation, lowercases, collapses whitespace
 */
function normalizeToken(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize a string into normalized words
 */
function tokenizeString(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Check if two tokens match with fuzzy tolerance
 * Allows ~20% character mismatch for OCR errors
 */
function tokensMatch(token1: string, token2: string, tolerance: number = 0.2): boolean {
  if (token1 === token2) return true;
  
  const maxLen = Math.max(token1.length, token2.length);
  if (maxLen === 0) return true;
  
  // Quick rejection for very different lengths
  const lenDiff = Math.abs(token1.length - token2.length);
  if (lenDiff > Math.ceil(maxLen * tolerance)) return false;
  
  const distance = levenshteinDistance(token1, token2);
  const similarity = 1 - (distance / maxLen);
  
  return similarity >= (1 - tolerance);
}

// ============= PDF Document Map Class =============

export class PdfDocumentMap {
  private tokens: PdfToken[] = [];
  private pageMetadata: Map<number, PdfPageMetadata> = new Map();
  private tokensByPage: Map<number, PdfToken[]> = new Map();
  private isIndexed: boolean = false;

  /**
   * Index a PDF document, extracting all tokens with their positions
   */
  async indexPdf(pdfDoc: pdfjsLib.PDFDocumentProxy): Promise<void> {
    this.tokens = [];
    this.pageMetadata.clear();
    this.tokensByPage.clear();
    
    let tokenId = 0;

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      const pageIndex = pageNum - 1;
      const page = await pdfDoc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.0 });
      const textContent = await page.getTextContent();
      
      const pageTokens: PdfToken[] = [];
      const startTokenId = tokenId;

      for (const item of textContent.items as any[]) {
        if (!item.str || !item.str.trim()) continue;

        // Extract geometry from transform matrix
        const transform = item.transform;
        const pdfX = transform[4];
        const pdfY = transform[5];
        const fontSize = Math.abs(transform[0]) || 12;
        const itemWidth = item.width || (item.str.length * fontSize * 0.5);
        const itemHeight = fontSize * 1.2;

        // Tokenize the string item
        const words = item.str.split(/\s+/).filter((w: string) => w.length > 0);
        
        if (words.length === 0) continue;

        // Calculate approximate width per character
        const charWidth = itemWidth / Math.max(item.str.length, 1);
        let currentX = pdfX;

        for (const word of words) {
          const tokenWidth = word.length * charWidth;
          
          pageTokens.push({
            id: tokenId++,
            text: normalizeToken(word),
            rawText: word,
            pageIndex,
            rect: {
              x: currentX,
              y: pdfY,
              width: tokenWidth,
              height: itemHeight,
            },
          });

          // Move X position for next word (add space width)
          currentX += tokenWidth + charWidth;
        }
      }

      this.tokensByPage.set(pageIndex, pageTokens);
      this.tokens.push(...pageTokens);

      this.pageMetadata.set(pageIndex, {
        pageIndex,
        pageHeight: viewport.height,
        pageWidth: viewport.width,
        tokenCount: pageTokens.length,
        startTokenId,
        endTokenId: tokenId - 1,
      });
    }

    this.isIndexed = true;
    console.log(`[PdfDocumentMap] Indexed ${this.tokens.length} tokens across ${pdfDoc.numPages} pages`);
  }

  /**
   * Get tokens for a specific page
   */
  getPageTokens(pageIndex: number): PdfToken[] {
    return this.tokensByPage.get(pageIndex) || [];
  }

  /**
   * Get page metadata
   */
  getPageMetadata(pageIndex: number): PdfPageMetadata | undefined {
    return this.pageMetadata.get(pageIndex);
  }

  /**
   * Get total number of pages
   */
  get totalPages(): number {
    return this.pageMetadata.size;
  }

  /**
   * Get all tokens
   */
  getAllTokens(): PdfToken[] {
    return this.tokens;
  }

  /**
   * Find claim location using sliding window sequence matching
   * Returns matched token rects grouped by page
   */
  findClaimLocation(claimText: string, claimId: string): ClaimLocation[] {
    if (!this.isIndexed || !claimText || claimText.length < 10) {
      return [];
    }

    const claimTokens = tokenizeString(claimText);
    if (claimTokens.length < 2) return [];

    const results: ClaimLocation[] = [];
    const matchThreshold = 0.8; // 80% of tokens must match

    // Sliding window search across all tokens
    for (let i = 0; i <= this.tokens.length - claimTokens.length; i++) {
      let matchCount = 0;
      const candidateTokens: PdfToken[] = [];

      for (let j = 0; j < claimTokens.length; j++) {
        const pdfToken = this.tokens[i + j];
        const claimToken = claimTokens[j];

        if (tokensMatch(pdfToken.text, claimToken)) {
          matchCount++;
        }
        candidateTokens.push(pdfToken);
      }

      const matchRatio = matchCount / claimTokens.length;

      if (matchRatio >= matchThreshold) {
        // Found a match - group rects by page
        const pageIndex = candidateTokens[0].pageIndex;
        const rects = this.mergeAdjacentRects(candidateTokens);

        results.push({
          claimId,
          pageIndex,
          rects,
          tokens: candidateTokens,
        });

        // Skip past this match to avoid overlapping results
        i += claimTokens.length - 1;
      }
    }

    return results;
  }

  /**
   * Find the best page for a paragraph text (for navigation)
   */
  findBestPageForText(text: string): number {
    const textTokens = tokenizeString(text);
    if (textTokens.length < 3) return 0;

    // Use first few words as anchor
    const anchorTokens = textTokens.slice(0, Math.min(6, textTokens.length));
    
    let bestPage = 0;
    let bestScore = 0;

    for (const [pageIndex, pageTokens] of this.tokensByPage) {
      // Quick word overlap check
      const pageTokenSet = new Set(pageTokens.map(t => t.text));
      let overlap = 0;
      for (const token of anchorTokens) {
        if (pageTokenSet.has(token)) overlap++;
      }

      if (overlap > bestScore) {
        bestScore = overlap;
        bestPage = pageIndex;
      }
    }

    return bestPage;
  }

  /**
   * Merge adjacent tokens on the same line into larger rects
   * Prevents "highlight jitter" from many small boxes
   */
  private mergeAdjacentRects(tokens: PdfToken[]): PdfToken['rect'][] {
    if (tokens.length === 0) return [];

    const lineThreshold = 5; // Pixels tolerance for same line
    const gapThreshold = 20; // Max gap between words on same line

    // Group tokens by line (similar Y position)
    const lines: Map<number, PdfToken[]> = new Map();

    for (const token of tokens) {
      const lineKey = Math.round(token.rect.y / lineThreshold) * lineThreshold;
      const existing = lines.get(lineKey) || [];
      existing.push(token);
      lines.set(lineKey, existing);
    }

    const mergedRects: PdfToken['rect'][] = [];

    for (const lineTokens of lines.values()) {
      // Sort by X position
      const sorted = lineTokens.sort((a, b) => a.rect.x - b.rect.x);

      let currentRect: PdfToken['rect'] | null = null;

      for (const token of sorted) {
        if (!currentRect) {
          currentRect = { ...token.rect };
        } else {
          const gap = token.rect.x - (currentRect.x + currentRect.width);

          if (gap <= gapThreshold) {
            // Extend current rect
            const newWidth = (token.rect.x + token.rect.width) - currentRect.x;
            currentRect.width = newWidth;
            currentRect.height = Math.max(currentRect.height, token.rect.height);
          } else {
            // Gap too large, start new rect
            mergedRects.push(currentRect);
            currentRect = { ...token.rect };
          }
        }
      }

      if (currentRect) {
        mergedRects.push(currentRect);
      }
    }

    return mergedRects;
  }
}

// ============= Legacy Compatibility Layer =============
// These exports maintain backwards compatibility with existing code

/**
 * Build page text from regions (legacy compatibility)
 */
export function buildPageTextFromRegions(regions: TextRegion[]): string {
  return regions.map(r => r.text).join(' ');
}

export interface PdfTextMap {
  pages: { pageNumber: number; startOffset: number; endOffset: number; text: string; normalizedText: string }[];
  fullText: string;
  totalPages: number;
}

export interface TextRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  charStart?: number;
  charEnd?: number;
}

/**
 * Build a text map from PDF (legacy compatibility)
 */
export async function buildPdfTextMap(pdfDoc: pdfjsLib.PDFDocumentProxy): Promise<PdfTextMap> {
  const pages: PdfTextMap['pages'] = [];
  let fullText = '';
  let currentOffset = 0;

  for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const textContent = await page.getTextContent();

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
      normalizedText: pageText.toLowerCase().replace(/[^\w\s]/g, ''),
    });

    fullText += (fullText ? ' ' : '') + pageText;
    currentOffset = endOffset + 1;
  }

  return { pages, fullText, totalPages: pdfDoc.numPages };
}

/**
 * Find best page for paragraph (legacy compatibility)
 */
export function findBestPageForParagraph(textMap: PdfTextMap, paragraphText: string): number {
  const normalizedSearch = paragraphText.toLowerCase().replace(/[^\w\s]/g, '');
  const searchWords = normalizedSearch.split(/\s+/).slice(0, 8);
  const firstPhrase = searchWords.join(' ');

  let bestPage = 1;
  let bestScore = 0;

  for (const page of textMap.pages) {
    let score = 0;
    if (page.normalizedText.includes(firstPhrase)) {
      score = 1;
    } else {
      const pageWords = new Set(page.normalizedText.split(/\s+/));
      const overlap = searchWords.filter(w => pageWords.has(w)).length;
      score = overlap / searchWords.length;
    }

    if (score > bestScore) {
      bestScore = score;
      bestPage = page.pageNumber;
    }
  }

  return bestPage;
}

/**
 * Extract page text regions (legacy compatibility)
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
    const fontSize = Math.abs(transform[0]) || 12;
    const width = item.width || (item.str.length * fontSize * 0.5);
    const height = fontSize * 1.2;

    const [a, b, c, d, e, f] = viewport.transform;
    const canvasX = a * x + c * y + e;
    const canvasY = b * x + d * y + f;

    regions.push({
      x: canvasX,
      y: canvasY - height,
      width,
      height: height + 2,
      text: item.str,
      charStart: charOffset,
      charEnd: charOffset + item.str.length,
    });

    charOffset += item.str.length + 1;
  }

  return regions;
}

/**
 * Find matching regions (legacy compatibility)
 */
export function findMatchingRegions(
  regions: TextRegion[],
  searchText: string
): TextRegion[] {
  if (regions.length === 0 || !searchText || searchText.length < 20) return [];

  const normalizedSearch = searchText.toLowerCase().replace(/[^\w\s]/g, '');
  const searchWords = normalizedSearch.split(/\s+/).filter(w => w.length > 0);
  if (searchWords.length < 3) return [];

  const firstPhrase = searchWords.slice(0, 5).join(' ');
  const lastPhrase = searchWords.slice(-4).join(' ');

  const regionData = regions.map((region, idx) => ({
    region,
    idx,
    normalizedText: region.text.toLowerCase().replace(/[^\w\s]/g, ''),
  }));

  // Find start
  let startIdx = -1;
  for (let i = 0; i < regionData.length; i++) {
    let runningText = '';
    for (let j = i; j < Math.min(i + 12, regionData.length); j++) {
      runningText += (runningText ? ' ' : '') + regionData[j].normalizedText;
      if (runningText.length > firstPhrase.length + 30) break;
    }
    if (runningText.includes(firstPhrase)) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) return [];

  // Find end
  const maxEndIdx = Math.min(startIdx + Math.ceil(searchWords.length / 2) + 15, regionData.length);
  let endIdx = -1;

  for (let i = maxEndIdx - 1; i >= startIdx; i--) {
    let runningText = '';
    for (let j = i; j >= Math.max(i - 8, startIdx); j--) {
      runningText = regionData[j].normalizedText + (runningText ? ' ' : '') + runningText;
      if (runningText.length > lastPhrase.length + 30) break;
    }
    if (runningText.includes(lastPhrase)) {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1 || endIdx < startIdx) {
    endIdx = Math.min(startIdx + Math.ceil(searchWords.length / 2), regionData.length - 1);
  }

  return regions.slice(startIdx, endIdx + 1);
}

/**
 * Find claim regions (legacy compatibility)
 */
export function findClaimRegions(
  paragraphRegions: TextRegion[],
  claimText: string
): TextRegion[] {
  if (paragraphRegions.length === 0 || !claimText || claimText.length < 10) {
    return [];
  }

  const normalizedClaim = claimText.toLowerCase().replace(/[^\w\s]/g, '');
  const claimWords = normalizedClaim.split(/\s+/).filter(w => w.length > 0);
  if (claimWords.length < 2) return [];

  const firstPhrase = claimWords.slice(0, 4).join(' ');
  const lastPhrase = claimWords.slice(-3).join(' ');

  const regionData = paragraphRegions.map((region, idx) => ({
    region,
    idx,
    normalizedText: region.text.toLowerCase().replace(/[^\w\s]/g, ''),
  }));

  // Find start
  let startIdx = -1;
  for (let i = 0; i < regionData.length; i++) {
    let runningText = '';
    for (let j = i; j < Math.min(i + 8, regionData.length); j++) {
      runningText += (runningText ? ' ' : '') + regionData[j].normalizedText;
      if (runningText.length > firstPhrase.length + 20) break;
    }
    if (runningText.includes(firstPhrase)) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) return [];

  // Find end
  const maxEndIdx = Math.min(startIdx + Math.ceil(claimWords.length / 2) + 10, regionData.length);
  let endIdx = -1;

  for (let i = maxEndIdx - 1; i >= startIdx; i--) {
    let runningText = '';
    for (let j = i; j >= Math.max(i - 6, startIdx); j--) {
      runningText = regionData[j].normalizedText + (runningText ? ' ' : '') + runningText;
      if (runningText.length > lastPhrase.length + 20) break;
    }
    if (runningText.includes(lastPhrase)) {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1 || endIdx < startIdx) {
    endIdx = Math.min(startIdx + Math.ceil(claimWords.length / 2), regionData.length - 1);
  }

  return paragraphRegions.slice(startIdx, endIdx + 1);
}

/**
 * Get bounding box (legacy compatibility)
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
