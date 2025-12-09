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

/**
 * Extract individual citations from text, handling compound citations
 * Returns array of individual citation strings
 */
function extractIndividualCitations(text: string): string[] {
  const citations: string[] = [];
  
  // First, find all parenthetical content that looks like citations
  const parenPattern = /\(([^)]+(?:\d{4})[^)]*)\)/g;
  let match;
  
  while ((match = parenPattern.exec(text)) !== null) {
    const content = match[1];
    
    // Check if it contains citation-like content (has year and author-like text)
    if (!/\d{4}/.test(content)) continue;
    if (!/[A-Z][a-z]/.test(content)) continue;
    
    // Split by semicolon for compound citations
    const parts = content.split(/\s*;\s*/);
    
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      
      // Validate this looks like a citation (Author, Year or Author (Year) or Author Year)
      if (/[A-Z][a-zA-Z''-]+.*\d{4}/.test(trimmed)) {
        citations.push(`(${trimmed})`);
      }
    }
  }
  
  // Also find narrative citations: Author (Year) or Author et al. (Year)
  const narrativePattern = /([A-Z][a-zA-Z''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z''-]+))?)\s*\((\d{4}[a-z]?)\)/g;
  
  while ((match = narrativePattern.exec(text)) !== null) {
    const fullMatch = match[0];
    // Check it's not already captured inside parentheses
    const prevChar = text[match.index - 1];
    if (prevChar !== '(' && prevChar !== ';') {
      citations.push(fullMatch);
    }
  }
  
  return citations;
}

/**
 * Normalize a citation string for comparison
 */
function normalizeCitation(citation: string): string {
  return citation
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'")
    .replace(/et\s+al\.?/gi, 'et al.')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s+and\s+/gi, ' & ')
    .replace(/^\(|\)$/g, '') // Remove outer parentheses
    .trim();
}

/**
 * Extract author surname and year from a normalized citation
 */
function extractAuthorYear(normalized: string): { author: string; year: string } | null {
  // Pattern: author (possibly with "et al."), then year
  const match = normalized.match(/^([a-z][a-z''-]+)(?:\s+(?:et\s+al\.?|&\s+[a-z][a-z''-]+))?[,\s]+(\d{4})/i);
  if (match) {
    return { author: match[1].toLowerCase(), year: match[2] };
  }
  return null;
}

/**
 * Parse authors string and extract FIRST author surname (by publication order - APA standard)
 * APA format uses first listed author, reflecting contribution order
 * Format: "Nanda, M., Challapally, A., Pease, C." -> "Nanda"
 */
function extractFirstAuthor(authorsStr: string): string {
  if (!authorsStr) return '';
  
  const trimmed = authorsStr.trim();
  
  // APA format: "Surname, Initial., Surname2, Initial.,"
  // First surname is the first listed author
  const apaMatch = trimmed.match(/^([A-Z][a-zA-Z''-]+),\s*[A-Z]\.?/);
  if (apaMatch) {
    return apaMatch[1];
  }
  
  // Fallback: "Firstname Lastname" format - take last word
  const firstPart = trimmed.split(/[,;&]/).map(s => s.trim()).filter(Boolean)[0] || '';
  const words = firstPart.split(/\s+/).filter(w => w.length > 1 && !/^[A-Z]\.?$/.test(w));
  return words[words.length - 1] || words[0] || '';
}

/**
 * Count authors in a string
 */
function countAuthors(authorsStr: string): number {
  if (!authorsStr) return 0;
  
  // APA format: count surname-initial pairs
  const matches = authorsStr.match(/[A-Z][a-zA-Z''-]+,\s*[A-Z]\.?/g);
  if (matches && matches.length > 0) {
    return matches.length;
  }
  
  // Fallback: split by & or "and"
  return authorsStr.split(/\s*(?:&|\s+and\s+)\s*/).length;
}

/**
 * Generate all possible in-text label variants for a source
 */
function normalizeSourceLabel(source: Source): string[] {
  const variants: string[] = [];
  
  // Add in_text_label if exists (highest priority)
  if (source.in_text_label) {
    const label = source.in_text_label.trim();
    variants.push(normalizeCitation(label));
  }
  
  // Generate from authors and year
  if (source.authors && source.year) {
    const firstAuthor = extractFirstAuthor(source.authors);
    const authorCount = countAuthors(source.authors);
    const year = source.year.toString();
    
    if (firstAuthor) {
      if (authorCount === 1) {
        variants.push(normalizeCitation(`${firstAuthor}, ${year}`));
        variants.push(normalizeCitation(`${firstAuthor} ${year}`));
      } else if (authorCount === 2) {
        variants.push(normalizeCitation(`${firstAuthor} et al., ${year}`));
        variants.push(normalizeCitation(`${firstAuthor}, ${year}`));
      } else {
        variants.push(normalizeCitation(`${firstAuthor} et al., ${year}`));
        variants.push(normalizeCitation(`${firstAuthor} et al. ${year}`));
      }
    }
  }
  
  return [...new Set(variants)];
}

export function detectCitations(text: string): Map<string, { raw: string; count: number }> {
  const citations = new Map<string, { raw: string; count: number }>();
  
  const extracted = extractIndividualCitations(text);
  
  for (const citation of extracted) {
    const normalized = normalizeCitation(citation);
    
    // Skip very short or invalid matches
    if (normalized.length < 5) continue;
    if (!/[a-z].*\d{4}/i.test(normalized)) continue;
    
    if (citations.has(normalized)) {
      citations.get(normalized)!.count++;
    } else {
      citations.set(normalized, { raw: citation, count: 1 });
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
  const sourceAuthorYears = new Map<string, string>(); // "author|year" -> source id
  
  for (const source of sources) {
    const variants = normalizeSourceLabel(source);
    for (const variant of variants) {
      if (variant) {
        sourceVariants.set(variant, source.id);
        
        // Also extract author+year for fuzzy matching
        const ay = extractAuthorYear(variant);
        if (ay) {
          sourceAuthorYears.set(`${ay.author}|${ay.year}`, source.id);
        }
      }
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
      // Try author+year match
      const citationAY = extractAuthorYear(normalized);
      if (citationAY) {
        const key = `${citationAY.author}|${citationAY.year}`;
        if (sourceAuthorYears.has(key)) {
          matched = true;
          matchedSourceId = sourceAuthorYears.get(key);
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
