/**
 * Text Anchoring System
 * Provides stable IDs and character offsets for paragraphs and claims
 * to enable reliable mapping between different views (claims list, full text, PDF)
 */

export interface TextAnchor {
  id: string;
  startOffset: number;  // Character offset in full document
  endOffset: number;
  normalizedText: string;  // For fuzzy matching
  paragraphIndex: number;
  claimIndex?: number;
}

export interface ParagraphAnchor {
  id: string;
  paragraphIndex: number;
  startOffset: number;
  endOffset: number;
  text: string;
  normalizedText: string;
  claims: ClaimAnchor[];
}

export interface ClaimAnchor {
  id: string;
  paragraphIndex: number;
  claimIndex: number;
  startOffsetInParagraph: number;
  endOffsetInParagraph: number;
  globalStartOffset: number;
  globalEndOffset: number;
  text: string;
  normalizedText: string;
}

/**
 * Normalize text for fuzzy matching
 * - Lowercase
 * - Collapse whitespace
 * - Remove extra punctuation
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[""'']/g, '"')
    .replace(/[–—]/g, '-')
    .trim();
}

/**
 * Generate a stable ID for a paragraph or claim
 */
export function generateAnchorId(paragraphIndex: number, claimIndex?: number): string {
  if (claimIndex !== undefined) {
    return `p${paragraphIndex}-c${claimIndex}`;
  }
  return `p${paragraphIndex}`;
}

/**
 * Create paragraph anchors from an array of paragraph texts
 * Tracks character offsets relative to the full document
 */
export function createParagraphAnchors(paragraphs: string[]): ParagraphAnchor[] {
  const anchors: ParagraphAnchor[] = [];
  let currentOffset = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i];
    const startOffset = currentOffset;
    const endOffset = currentOffset + text.length;

    anchors.push({
      id: generateAnchorId(i),
      paragraphIndex: i,
      startOffset,
      endOffset,
      text,
      normalizedText: normalizeText(text),
      claims: [],
    });

    // Account for paragraph separator (double newline)
    currentOffset = endOffset + 2;
  }

  return anchors;
}

/**
 * Find the position of claim text within a paragraph using fuzzy matching
 * Returns start and end offsets within the paragraph, or null if not found
 */
export function findClaimInParagraph(
  paragraphText: string,
  claimText: string
): { start: number; end: number } | null {
  // Try exact match first
  const exactIndex = paragraphText.indexOf(claimText);
  if (exactIndex !== -1) {
    return { start: exactIndex, end: exactIndex + claimText.length };
  }

  // Try normalized match
  const normalizedParagraph = normalizeText(paragraphText);
  const normalizedClaim = normalizeText(claimText);
  
  const normalizedIndex = normalizedParagraph.indexOf(normalizedClaim);
  if (normalizedIndex !== -1) {
    // Map back to original text position (approximate)
    const ratio = paragraphText.length / normalizedParagraph.length;
    const approxStart = Math.floor(normalizedIndex * ratio);
    const approxEnd = Math.min(
      paragraphText.length,
      Math.ceil((normalizedIndex + normalizedClaim.length) * ratio)
    );
    return { start: approxStart, end: approxEnd };
  }

  // Try finding by first/last n words
  const claimWords = claimText.split(/\s+/);
  if (claimWords.length >= 4) {
    const firstWords = claimWords.slice(0, 3).join(' ');
    const lastWords = claimWords.slice(-3).join(' ');
    
    const firstIndex = paragraphText.indexOf(firstWords);
    const lastIndex = paragraphText.lastIndexOf(lastWords);
    
    if (firstIndex !== -1 && lastIndex !== -1 && lastIndex > firstIndex) {
      return { start: firstIndex, end: lastIndex + lastWords.length };
    }
  }

  return null;
}

/**
 * Add claim anchors to paragraph anchors
 * This should be called after AI check results are available
 */
export function addClaimAnchors(
  paragraphAnchors: ParagraphAnchor[],
  paragraphIndex: number,
  claimTexts: string[]
): void {
  const anchor = paragraphAnchors.find(a => a.paragraphIndex === paragraphIndex);
  if (!anchor) return;

  anchor.claims = claimTexts.map((claimText, claimIndex) => {
    const position = findClaimInParagraph(anchor.text, claimText);
    const startInParagraph = position?.start ?? 0;
    const endInParagraph = position?.end ?? claimText.length;

    return {
      id: generateAnchorId(paragraphIndex, claimIndex),
      paragraphIndex,
      claimIndex,
      startOffsetInParagraph: startInParagraph,
      endOffsetInParagraph: endInParagraph,
      globalStartOffset: anchor.startOffset + startInParagraph,
      globalEndOffset: anchor.startOffset + endInParagraph,
      text: claimText,
      normalizedText: normalizeText(claimText),
    };
  });
}

/**
 * Levenshtein distance for fuzzy string comparison
 */
export function levenshteinDistance(a: string, b: string): number {
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
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
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
 * Calculate similarity ratio between two strings (0-1)
 */
export function stringSimilarity(a: string, b: string): number {
  const normalizedA = normalizeText(a);
  const normalizedB = normalizeText(b);
  
  if (normalizedA === normalizedB) return 1;
  
  const maxLen = Math.max(normalizedA.length, normalizedB.length);
  if (maxLen === 0) return 1;
  
  const distance = levenshteinDistance(normalizedA, normalizedB);
  return 1 - distance / maxLen;
}

/**
 * Find the best matching paragraph for a given text using fuzzy matching
 */
export function findBestMatchingParagraph(
  text: string,
  anchors: ParagraphAnchor[],
  minSimilarity: number = 0.7
): ParagraphAnchor | null {
  const normalizedText = normalizeText(text);
  
  let bestMatch: ParagraphAnchor | null = null;
  let bestScore = 0;

  for (const anchor of anchors) {
    // Check if text is contained or contains the anchor text
    if (anchor.normalizedText.includes(normalizedText) || 
        normalizedText.includes(anchor.normalizedText)) {
      const containmentScore = Math.min(normalizedText.length, anchor.normalizedText.length) / 
                               Math.max(normalizedText.length, anchor.normalizedText.length);
      if (containmentScore > bestScore) {
        bestScore = containmentScore;
        bestMatch = anchor;
      }
    }

    // For shorter texts, use word overlap
    if (normalizedText.length < 200) {
      const textWords = new Set(normalizedText.split(/\s+/));
      const anchorWords = anchor.normalizedText.split(/\s+/);
      const matchedWords = anchorWords.filter(w => textWords.has(w)).length;
      const overlapScore = matchedWords / Math.max(textWords.size, anchorWords.length);
      
      if (overlapScore > bestScore) {
        bestScore = overlapScore;
        bestMatch = anchor;
      }
    }
  }

  return bestScore >= minSimilarity ? bestMatch : null;
}

/**
 * Get first N words from text (for matching)
 */
export function getFirstNWords(text: string, n: number): string {
  return normalizeText(text).split(/\s+/).slice(0, n).join(' ');
}

/**
 * Get last N words from text (for matching)
 */
export function getLastNWords(text: string, n: number): string {
  const words = normalizeText(text).split(/\s+/);
  return words.slice(-n).join(' ');
}
