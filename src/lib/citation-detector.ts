/**
 * Detects in-text citations from thesis text and compares them against the source library
 */

import { Source } from './types';

export interface DetectedCitation {
  raw: string;           // The raw citation text found (e.g., "(Smith et al., 2023)")
  normalized: string;    // Normalized version for matching
  count: number;         // How many times it appears
  matched: boolean;      // Whether it matches a source in the library
  matchedSourceId?: string;
}

export interface CitationAnalysis {
  detectedCitations: DetectedCitation[];
  matchedCount: number;
  missingCount: number;
  totalCitations: number;
}

// Common citation patterns
const CITATION_PATTERNS = [
  // APA style: (Author, Year) or (Author et al., Year)
  /\(([A-Z][a-zA-Z''-]+(?:\s+(?:et\s+al\.|&\s+[A-Z][a-zA-Z''-]+))?),?\s*(\d{4}[a-z]?)\)/g,
  // Multiple authors: (Author & Author, Year) or (Author, Author, & Author, Year)
  /\(([A-Z][a-zA-Z''-]+(?:\s*[,&]\s*[A-Z][a-zA-Z''-]+)+),?\s*(\d{4}[a-z]?)\)/g,
  // Narrative: Author (Year) or Author et al. (Year)
  /([A-Z][a-zA-Z''-]+(?:\s+et\s+al\.)?)\s+\((\d{4}[a-z]?)\)/g,
  // Harvard variations
  /\(([A-Z][a-zA-Z''-]+(?:\s+(?:and|&)\s+[A-Z][a-zA-Z''-]+)?(?:\s+et\s+al\.)?),?\s*(\d{4}[a-z]?)\)/g,
];

function normalizeCitation(citation: string): string {
  return citation
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")
    .replace(/et\s+al\./g, 'et al.')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*&\s*/g, ' & ')
    .trim();
}

function normalizeSourceLabel(source: Source): string[] {
  const variants: string[] = [];
  
  // Add in_text_label if exists
  if (source.in_text_label) {
    variants.push(normalizeCitation(source.in_text_label));
    // Also add without parentheses
    const withoutParens = source.in_text_label.replace(/^\(|\)$/g, '');
    variants.push(normalizeCitation(withoutParens));
  }
  
  // Generate from authors and year
  if (source.authors && source.year) {
    const authorParts = source.authors.split(/[,;&]/).map(a => a.trim()).filter(Boolean);
    const firstAuthor = authorParts[0]?.split(' ').pop() || ''; // Last name
    const year = source.year.toString();
    
    if (authorParts.length === 1) {
      variants.push(normalizeCitation(`(${firstAuthor}, ${year})`));
      variants.push(normalizeCitation(`${firstAuthor}, ${year}`));
    } else if (authorParts.length === 2) {
      const secondAuthor = authorParts[1]?.split(' ').pop() || '';
      variants.push(normalizeCitation(`(${firstAuthor} & ${secondAuthor}, ${year})`));
      variants.push(normalizeCitation(`${firstAuthor} & ${secondAuthor}, ${year}`));
    } else {
      variants.push(normalizeCitation(`(${firstAuthor} et al., ${year})`));
      variants.push(normalizeCitation(`${firstAuthor} et al., ${year}`));
    }
  }
  
  return variants;
}

export function detectCitations(text: string): Map<string, { raw: string; count: number }> {
  const citations = new Map<string, { raw: string; count: number }>();
  
  for (const pattern of CITATION_PATTERNS) {
    // Reset lastIndex for global regex
    pattern.lastIndex = 0;
    let match;
    
    while ((match = pattern.exec(text)) !== null) {
      const fullMatch = match[0];
      const normalized = normalizeCitation(fullMatch);
      
      if (citations.has(normalized)) {
        const existing = citations.get(normalized)!;
        existing.count++;
      } else {
        citations.set(normalized, { raw: fullMatch, count: 1 });
      }
    }
  }
  
  return citations;
}

export function analyzeCitations(text: string, sources: Source[]): CitationAnalysis {
  const detectedMap = detectCitations(text);
  const detectedCitations: DetectedCitation[] = [];
  let matchedCount = 0;
  
  // Build source lookup with all variants
  const sourceVariants = new Map<string, string>(); // normalized -> source id
  for (const source of sources) {
    const variants = normalizeSourceLabel(source);
    for (const variant of variants) {
      sourceVariants.set(variant, source.id);
    }
  }
  
  // Match detected citations against sources
  for (const [normalized, { raw, count }] of detectedMap) {
    let matched = false;
    let matchedSourceId: string | undefined;
    
    // Try exact match first
    if (sourceVariants.has(normalized)) {
      matched = true;
      matchedSourceId = sourceVariants.get(normalized);
    } else {
      // Try fuzzy match - check if any source variant is contained in the citation or vice versa
      for (const [variant, sourceId] of sourceVariants) {
        if (normalized.includes(variant) || variant.includes(normalized)) {
          matched = true;
          matchedSourceId = sourceId;
          break;
        }
      }
    }
    
    if (matched) matchedCount++;
    
    detectedCitations.push({
      raw,
      normalized,
      count,
      matched,
      matchedSourceId,
    });
  }
  
  return {
    detectedCitations: detectedCitations.sort((a, b) => b.count - a.count),
    matchedCount,
    missingCount: detectedCitations.length - matchedCount,
    totalCitations: detectedCitations.length,
  };
}

export function getMissingSources(analysis: CitationAnalysis): DetectedCitation[] {
  return analysis.detectedCitations.filter(c => !c.matched);
}
