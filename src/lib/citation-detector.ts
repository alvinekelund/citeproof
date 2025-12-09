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

// Common citation patterns - more comprehensive
const CITATION_PATTERNS = [
  // APA style: (Author, Year) or (Author et al., Year) - with comma before year
  /\(([A-Z][a-zA-Z''-]+(?:\s+et\s+al\.)?),?\s*(\d{4}[a-z]?)\)/g,
  // Two authors: (Author & Author, Year)
  /\(([A-Z][a-zA-Z''-]+\s*(?:&|and)\s*[A-Z][a-zA-Z''-]+),?\s*(\d{4}[a-z]?)\)/g,
  // Narrative: Author (Year) or Author et al. (Year)
  /([A-Z][a-zA-Z''-]+(?:\s+et\s+al\.)?)\s*\((\d{4}[a-z]?)\)/g,
  // Multiple citations in one: (Author, Year; Author, Year)
  /\(([A-Z][a-zA-Z''-]+(?:\s+et\s+al\.)?),?\s*(\d{4}[a-z]?)(?:\s*;\s*[A-Z][a-zA-Z''-]+(?:\s+et\s+al\.)?),?\s*\d{4}[a-z]?\)/g,
];

function normalizeCitation(citation: string): string {
  return citation
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")
    .replace(/et\s+al\./gi, 'et al.')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s+and\s+/gi, ' & ')
    .replace(/^\(|\)$/g, '') // Remove outer parentheses for comparison
    .trim();
}

/**
 * Parse authors string in various formats and extract the first author's surname
 * Handles formats like:
 * - "Nanda, M., Challapally, A., Pease, C." (APA style)
 * - "John Smith, Jane Doe" (simple names)
 * - "Smith, John" (inverted single)
 */
function extractFirstAuthorSurname(authorsStr: string): string {
  if (!authorsStr) return '';
  
  const trimmed = authorsStr.trim();
  
  // Check if it's in "Surname, Initial." format (APA)
  // Pattern: Surname, X., Surname2, Y., ...
  const apaPattern = /^([A-Z][a-zA-Z''-]+),\s*[A-Z]\.?(?:,|$)/;
  const apaMatch = trimmed.match(apaPattern);
  if (apaMatch) {
    return apaMatch[1];
  }
  
  // Check for "Surname, Firstname" format (single author inverted)
  const invertedPattern = /^([A-Z][a-zA-Z''-]+),\s+[A-Z][a-z]+/;
  const invertedMatch = trimmed.match(invertedPattern);
  if (invertedMatch) {
    return invertedMatch[1];
  }
  
  // Simple format: "John Smith" - take last word as surname
  const firstAuthor = trimmed.split(/[,;&]/).map(s => s.trim()).filter(Boolean)[0] || '';
  const nameParts = firstAuthor.split(/\s+/).filter(p => p.length > 1 && !/^[A-Z]\.?$/.test(p));
  
  // If we have multiple parts, last one is likely surname
  if (nameParts.length > 1) {
    return nameParts[nameParts.length - 1];
  }
  
  return nameParts[0] || '';
}

/**
 * Count authors in a string
 */
function countAuthors(authorsStr: string): number {
  if (!authorsStr) return 0;
  
  // APA format: "Surname, X., Surname2, Y." - count by pattern
  const apaMatches = authorsStr.match(/[A-Z][a-zA-Z''-]+,\s*[A-Z]\.?/g);
  if (apaMatches && apaMatches.length > 1) {
    return apaMatches.length;
  }
  
  // Simple split by & or "and"
  const parts = authorsStr.split(/\s*(?:&|,\s*&|\s+and\s+)\s*/);
  return parts.length;
}

function normalizeSourceLabel(source: Source): string[] {
  const variants: string[] = [];
  
  // Add in_text_label if exists (highest priority)
  if (source.in_text_label) {
    const label = source.in_text_label.trim();
    variants.push(normalizeCitation(label));
    // Also add without parentheses
    const withoutParens = label.replace(/^\(|\)$/g, '');
    variants.push(normalizeCitation(withoutParens));
  }
  
  // Generate from authors and year
  if (source.authors && source.year) {
    const firstAuthor = extractFirstAuthorSurname(source.authors);
    const authorCount = countAuthors(source.authors);
    const year = source.year.toString();
    
    if (firstAuthor) {
      if (authorCount === 1) {
        variants.push(normalizeCitation(`${firstAuthor}, ${year}`));
        variants.push(normalizeCitation(`${firstAuthor} ${year}`));
      } else if (authorCount === 2) {
        // For two authors, we'd need second author too
        // But often citations just use first author & second
        variants.push(normalizeCitation(`${firstAuthor} et al., ${year}`));
        variants.push(normalizeCitation(`${firstAuthor}, ${year}`));
      } else {
        variants.push(normalizeCitation(`${firstAuthor} et al., ${year}`));
        variants.push(normalizeCitation(`${firstAuthor} et al. ${year}`));
      }
    }
  }
  
  return [...new Set(variants)]; // Remove duplicates
}

export function detectCitations(text: string): Map<string, { raw: string; count: number }> {
  const citations = new Map<string, { raw: string; count: number }>();
  
  for (const pattern of CITATION_PATTERNS) {
    // Create a fresh regex to avoid lastIndex issues
    const freshPattern = new RegExp(pattern.source, pattern.flags);
    let match;
    
    while ((match = freshPattern.exec(text)) !== null) {
      const fullMatch = match[0];
      const normalized = normalizeCitation(fullMatch);
      
      // Skip very short matches (likely false positives)
      if (normalized.length < 5) continue;
      
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
      if (variant) {
        sourceVariants.set(variant, source.id);
      }
    }
  }
  
  console.log('Source variants for matching:', [...sourceVariants.keys()]);
  
  // Match detected citations against sources
  for (const [normalized, { raw, count }] of detectedMap) {
    let matched = false;
    let matchedSourceId: string | undefined;
    
    // Try exact match first
    if (sourceVariants.has(normalized)) {
      matched = true;
      matchedSourceId = sourceVariants.get(normalized);
    } else {
      // Extract author and year from citation for fuzzy matching
      const citationMatch = normalized.match(/([a-z][a-z''-]+)(?:\s+et\s+al\.?)?,?\s*(\d{4})/i);
      if (citationMatch) {
        const citAuthor = citationMatch[1].toLowerCase();
        const citYear = citationMatch[2];
        
        for (const [variant, sourceId] of sourceVariants) {
          const variantMatch = variant.match(/([a-z][a-z''-]+)(?:\s+et\s+al\.?)?,?\s*(\d{4})/i);
          if (variantMatch) {
            const varAuthor = variantMatch[1].toLowerCase();
            const varYear = variantMatch[2];
            
            // Match if author surname and year match
            if (citAuthor === varAuthor && citYear === varYear) {
              matched = true;
              matchedSourceId = sourceId;
              break;
            }
          }
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
