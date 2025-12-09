/**
 * Detects in-text citations from thesis text and compares them against the source library
 */

import { Source } from './types';
import { supabase } from '@/integrations/supabase/client';

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

// Patterns that look like citations but are actually paper IDs or other references
const FALSE_POSITIVE_PATTERNS = [
  /^ssrn/i,
  /^arxiv/i,
  /^nber/i,
  /^bis\s+working/i,
  /working\s+paper/i,
  /paper\s+no/i,
  /preprint/i,
  /^\d+\.\d+/,  // arXiv IDs like 2302.06590
  /^vol\./i,
  /^pp?\.\s*\d/i,
  /^doi:/i,
  /^http/i,
  /^www\./i,
];

// Valid citation must match this pattern: Author(s), Year format
const VALID_CITATION_PATTERN = /^[A-Z][a-zA-Z''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z''-]+|and\s+[A-Z][a-zA-Z''-]+))?[,\s]+\d{4}/i;

/**
 * Check if a string looks like a valid academic citation
 */
function isValidCitation(text: string): boolean {
  const trimmed = text.trim();
  
  // Filter out paper IDs and non-citations
  for (const pattern of FALSE_POSITIVE_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }
  
  // Must be a reasonable length
  if (trimmed.length < 8 || trimmed.length > 100) return false;
  
  // Must match valid citation pattern
  if (!VALID_CITATION_PATTERN.test(trimmed)) return false;
  
  // Should not contain too much extra text (like sentences)
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 10) return false;
  
  return true;
}

/**
 * Extract individual citations from text, handling compound citations
 * Returns array of individual citation strings
 */
function extractIndividualCitations(text: string): string[] {
  const citations: string[] = [];
  
  // Find all parenthetical content that looks like citations
  const parenPattern = /\(([^)]+)\)/g;
  let match;
  
  while ((match = parenPattern.exec(text)) !== null) {
    const content = match[1];
    
    // Must have a year
    if (!/\d{4}/.test(content)) continue;
    
    // Split by semicolon for compound citations
    const parts = content.split(/\s*;\s*/);
    
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      
      // Validate this is a proper citation
      if (isValidCitation(trimmed)) {
        citations.push(`(${trimmed})`);
      }
    }
  }
  
  // Also find narrative citations: Author (Year) or Author et al. (Year)
  // But exclude cases where it's part of a parenthetical citation like "(Blümelhuber & Novak, 2025)"
  const narrativePattern = /([A-Z][a-zA-Z''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z''-]+))?)\s*\((\d{4}[a-z]?)\)/g;
  
  while ((match = narrativePattern.exec(text)) !== null) {
    const author = match[1].trim();
    const year = match[2];
    const fullMatch = match[0];
    const startIdx = match.index;
    
    // Check if this match is inside a parenthetical citation
    // Look backward from the match to see if we're inside parentheses
    let depth = 0;
    let isInsideParens = false;
    for (let i = startIdx - 1; i >= Math.max(0, startIdx - 100); i--) {
      if (text[i] === ')') depth++;
      if (text[i] === '(') {
        depth--;
        if (depth < 0) {
          // We found an opening paren before a closing one - we're inside parentheses
          isInsideParens = true;
          break;
        }
      }
    }
    
    if (isInsideParens) continue;
    
    // Also check the character before - if it's & or "and", it's part of a compound author
    const textBefore = text.slice(Math.max(0, startIdx - 10), startIdx);
    if (/[&]\s*$/.test(textBefore) || /\band\s+$/i.test(textBefore)) continue;
    
    // Check it's not already captured inside parentheses
    const prevChar = text[startIdx - 1];
    if (prevChar !== '(' && prevChar !== ';') {
      const citation = `${author} (${year})`;
      if (isValidCitation(`${author}, ${year}`)) {
        citations.push(citation);
      }
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
 * Extract author surname and year from a citation (normalized or raw)
 * Handles both "(Author et al., 2025)" and "Author et al. (2025)" formats
 */
function extractAuthorYear(citation: string): { author: string; year: string } | null {
  // Strip all parentheses and extra punctuation first
  const cleaned = citation
    .replace(/[()]/g, '')
    .replace(/['']/g, "'")
    .toLowerCase()
    .trim();
  
  // Pattern 1: "author et al., 2025" or "author, 2025"
  let match = cleaned.match(/^([a-z][a-zäöüéèêëàâôîûç''-]+)(?:\s+(?:et\s+al\.?|&\s+[a-z][a-zäöüéèêëàâôîûç''-]+))?[,\s]+(\d{4})/i);
  if (match) {
    return { author: match[1].replace(/['-]/g, ''), year: match[2] };
  }
  
  // Pattern 2: "author & coauthor, 2025"
  match = cleaned.match(/^([a-z][a-zäöüéèêëàâôîûç''-]+)\s*&/i);
  const yearMatch = cleaned.match(/(\d{4})/);
  if (match && yearMatch) {
    return { author: match[1].replace(/['-]/g, ''), year: yearMatch[1] };
  }
  
  // Pattern 3: Just extract first word and year
  match = cleaned.match(/([a-z][a-zäöüéèêëàâôîûç]+).*?(\d{4})/i);
  if (match) {
    return { author: match[1].replace(/['-]/g, ''), year: match[2] };
  }
  
  return null;
}

/**
 * Create a deduplication key from citation (author+year)
 */
function getDedupeKey(citation: string): string {
  const extracted = extractAuthorYear(citation);
  if (extracted) {
    return `${extracted.author}_${extracted.year}`;
  }
  // Fallback: aggressive normalization
  return citation.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Client-side deduplication based on author+year
 */
export function clientSideDedup(citations: DetectedCitation[]): DetectedCitation[] {
  const groups = new Map<string, DetectedCitation[]>();
  
  for (const citation of citations) {
    const key = getDedupeKey(citation.raw);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(citation);
  }
  
  const result: DetectedCitation[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
    } else {
      // Pick best canonical form and sum counts
      const sorted = [...group].sort((a, b) => {
        // Prefer matched citations
        if (a.matched !== b.matched) return a.matched ? -1 : 1;
        // Prefer parenthetical format "(Author...)"
        const aParens = a.raw.startsWith('(');
        const bParens = b.raw.startsWith('(');
        if (aParens !== bParens) return aParens ? -1 : 1;
        // Prefer longer (more complete)
        return b.raw.length - a.raw.length;
      });
      
      const canonical = sorted[0];
      const totalCount = group.reduce((sum, c) => sum + c.count, 0);
      
      result.push({
        ...canonical,
        count: totalCount
      });
    }
  }
  
  return result;
}

/**
 * Parse authors string and extract FIRST author surname (by publication order - APA standard)
 */
function extractFirstAuthor(authorsStr: string): string {
  if (!authorsStr) return '';
  
  const trimmed = authorsStr.trim();
  
  // APA format: "Surname, Initial., Surname2, Initial.,"
  const apaMatch = trimmed.match(/^([A-Z][a-zA-Z''-]+),\s*[A-Z]\.?/);
  if (apaMatch) {
    return apaMatch[1];
  }
  
  // Fallback: "Firstname Lastname" format
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
    
    // Skip invalid matches
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

/**
 * Parse a citation string to extract author and year for creating a placeholder source
 */
export function parseCitationForPlaceholder(citation: string): { author: string; year: number | null; label: string } {
  const normalized = normalizeCitation(citation);
  const ay = extractAuthorYear(normalized);
  
  let label = citation.trim();
  // Ensure it has parentheses
  if (!label.startsWith('(')) label = `(${label}`;
  if (!label.endsWith(')')) label = `${label})`;
  
  return {
    author: ay?.author || '',
    year: ay?.year ? parseInt(ay.year, 10) : null,
    label,
  };
}

/**
 * Deduplicate citations - uses client-side dedup as primary method
 */
export function deduplicateCitationsSync(analysis: CitationAnalysis): CitationAnalysis {
  const dedupedCitations = clientSideDedup(analysis.detectedCitations);
  const matchedCount = dedupedCitations.filter(c => c.matched).length;
  
  console.log(`Client-side dedup: ${analysis.detectedCitations.length} -> ${dedupedCitations.length} citations`);
  
  return {
    detectedCitations: dedupedCitations.sort((a, b) => b.count - a.count),
    matchedCount,
    missingCount: dedupedCitations.length - matchedCount,
    totalCitations: dedupedCitations.length,
  };
}

/**
 * Use AI to deduplicate citations (with client-side fallback)
 */
export async function deduplicateCitations(analysis: CitationAnalysis): Promise<CitationAnalysis> {
  // Always apply client-side dedup first
  const clientDeduped = deduplicateCitationsSync(analysis);
  
  // Only call AI if there are still multiple unmatched citations
  const unmatchedCount = clientDeduped.detectedCitations.filter(c => !c.matched).length;
  if (unmatchedCount <= 1) {
    return clientDeduped;
  }

  try {
    const { data, error } = await supabase.functions.invoke('dedupe-citations', {
      body: { citations: clientDeduped.detectedCitations }
    });

    if (error) {
      console.error('AI deduplication error:', error);
      return clientDeduped;
    }

    if (data?.citations) {
      const dedupedCitations = data.citations as DetectedCitation[];
      const matchedCount = dedupedCitations.filter(c => c.matched).length;
      
      console.log(`AI dedup: ${data.deduped || 0} additional duplicates removed`);
      
      return {
        detectedCitations: dedupedCitations.sort((a, b) => b.count - a.count),
        matchedCount,
        missingCount: dedupedCitations.length - matchedCount,
        totalCitations: dedupedCitations.length,
      };
    }

    return clientDeduped;
  } catch (error) {
    console.error('Failed to call AI deduplication:', error);
    return clientDeduped;
  }
}
