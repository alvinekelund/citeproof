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

// ============= UNIFIED CHARACTER NORMALIZATION =============

/**
 * Normalize diacritics and special characters to ASCII equivalents
 */
function normalizeChars(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[''`]/g, "'")
    .replace(/[""]/g, '"')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ł/gi, 'l');
}

/**
 * Create a matching key from an author name - strips ALL special chars
 */
function normalizeAuthorForKey(author: string): string {
  return normalizeChars(author)
    .toLowerCase()
    .replace(/[^a-z]/g, ''); // Only keep letters
}

// ============= FALSE POSITIVE FILTERING =============

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

const VALID_CITATION_PATTERN = /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'''-]+|and\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'''-]+))?[,\s]+\d{4}/i;

function isValidCitation(text: string): boolean {
  const trimmed = text.trim();
  
  for (const pattern of FALSE_POSITIVE_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }
  
  if (trimmed.length < 8 || trimmed.length > 100) return false;
  if (!VALID_CITATION_PATTERN.test(trimmed)) return false;
  
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 10) return false;
  
  return true;
}

// ============= CITATION EXTRACTION =============

function extractIndividualCitations(text: string): string[] {
  const citations: string[] = [];
  
  // Find all parenthetical content that looks like citations
  const parenPattern = /\(([^)]+)\)/g;
  let match;
  
  while ((match = parenPattern.exec(text)) !== null) {
    const content = match[1];
    
    if (!/\d{4}/.test(content)) continue;
    
    // Split by semicolon for compound citations
    const parts = content.split(/\s*;\s*/);
    
    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      
      if (isValidCitation(trimmed)) {
        citations.push(`(${trimmed})`);
      }
    }
  }
  
  // Narrative citations: Author (Year) or Author et al. (Year)
  const narrativePattern = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'''-]+(?:\s+(?:et\s+al\.?|&\s+[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'''-]+))?)\s*\((\d{4}[a-z]?)\)/g;
  
  while ((match = narrativePattern.exec(text)) !== null) {
    const author = match[1].trim();
    const year = match[2];
    const startIdx = match.index;
    
    // Check if inside parentheses
    let depth = 0;
    let isInsideParens = false;
    for (let i = startIdx - 1; i >= Math.max(0, startIdx - 100); i--) {
      if (text[i] === ')') depth++;
      if (text[i] === '(') {
        depth--;
        if (depth < 0) {
          isInsideParens = true;
          break;
        }
      }
    }
    
    if (isInsideParens) continue;
    
    // Check for compound author
    const textBefore = text.slice(Math.max(0, startIdx - 10), startIdx);
    if (/[&]\s*$/.test(textBefore) || /\band\s+$/i.test(textBefore)) continue;
    
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

function normalizeCitation(citation: string): string {
  return normalizeChars(citation)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/et\s+al\.?/gi, 'et al.')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*&\s*/g, ' & ')
    .replace(/\s+and\s+/gi, ' & ')
    .replace(/^\(|\)$/g, '')
    .trim();
}

// ============= UNIFIED AUTHOR/YEAR EXTRACTION =============

interface AuthorYearInfo {
  primaryAuthor: string;      // Raw first author surname
  primaryAuthorKey: string;   // Normalized key for matching
  secondAuthor?: string;      // Second author if present
  secondAuthorKey?: string;   // Normalized key for matching
  year: string;
  authorCount: number;        // 1, 2, or 3+ (for et al.)
}

/**
 * Unified extraction of author(s) and year from a citation string
 * Used for BOTH thesis citations and source labels
 */
function extractAuthorYearInfo(text: string): AuthorYearInfo | null {
  const cleaned = normalizeChars(text)
    .replace(/[()]/g, '')
    .trim();
  
  // Extract year first
  const yearMatch = cleaned.match(/\b((?:19|20)\d{2})[a-z]?\b/);
  if (!yearMatch) return null;
  const year = yearMatch[1];
  
  // Remove year for author parsing
  const withoutYear = cleaned.replace(/[,\s]*\b(?:19|20)\d{2}[a-z]?\b.*$/, '').trim();
  
  // Check for "et al."
  const hasEtAl = /et\s+al\.?/i.test(withoutYear);
  const withoutEtAl = withoutYear.replace(/\s*et\s+al\.?/gi, '').trim();
  
  // Check for two authors: "Author & Author" or "Author and Author"
  const twoAuthorMatch = withoutEtAl.match(/^([A-Za-z][A-Za-z'''-]+)\s*(?:&|and)\s*([A-Za-z][A-Za-z'''-]+)/i);
  
  if (twoAuthorMatch) {
    return {
      primaryAuthor: twoAuthorMatch[1],
      primaryAuthorKey: normalizeAuthorForKey(twoAuthorMatch[1]),
      secondAuthor: twoAuthorMatch[2],
      secondAuthorKey: normalizeAuthorForKey(twoAuthorMatch[2]),
      year,
      authorCount: 2,
    };
  }
  
  // Single author (with or without et al.)
  const singleMatch = withoutEtAl.match(/^([A-Za-z][A-Za-z'''-]+)/i);
  if (singleMatch) {
    return {
      primaryAuthor: singleMatch[1],
      primaryAuthorKey: normalizeAuthorForKey(singleMatch[1]),
      year,
      authorCount: hasEtAl ? 3 : 1,
    };
  }
  
  return null;
}

/**
 * Legacy function for backward compatibility
 */
function extractAuthorYear(citation: string): { author: string; year: string } | null {
  const info = extractAuthorYearInfo(citation);
  if (!info) return null;
  return { author: info.primaryAuthorKey, year: info.year };
}

/**
 * Create a deduplication key: "authorkey_year"
 */
function getDedupeKey(citation: string): string {
  const info = extractAuthorYearInfo(citation);
  if (info) {
    return `${info.primaryAuthorKey}_${info.year}`;
  }
  // Fallback
  return normalizeChars(citation).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Create a matching key that accounts for both authors in 2-author citations
 */
function getMatchingKey(citation: string): string[] {
  const info = extractAuthorYearInfo(citation);
  if (!info) return [];
  
  const keys: string[] = [];
  
  // Primary key: first author + year
  keys.push(`${info.primaryAuthorKey}|${info.year}`);
  
  // For 2-author citations, also add combined key
  if (info.authorCount === 2 && info.secondAuthorKey) {
    keys.push(`${info.primaryAuthorKey}+${info.secondAuthorKey}|${info.year}`);
  }
  
  return keys;
}

// ============= CLIENT-SIDE DEDUPLICATION =============

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
        if (a.matched !== b.matched) return a.matched ? -1 : 1;
        const aParens = a.raw.startsWith('(');
        const bParens = b.raw.startsWith('(');
        if (aParens !== bParens) return aParens ? -1 : 1;
        return b.raw.length - a.raw.length;
      });
      
      const canonical = sorted[0];
      const totalCount = group.reduce((sum, c) => sum + c.count, 0);
      
      // Preserve matchedSourceId if any in group matched
      const matchedOne = group.find(c => c.matched);
      
      result.push({
        ...canonical,
        count: totalCount,
        matched: !!matchedOne,
        matchedSourceId: matchedOne?.matchedSourceId || canonical.matchedSourceId,
      });
    }
  }
  
  return result;
}

// ============= SOURCE LABEL GENERATION =============

/**
 * Parse authors string to extract structured author info
 * Handles: "Surname, I., Surname2, I." (APA) and "Firstname Lastname, Firstname2 Lastname2"
 */
function parseAuthorsString(authorsStr: string): { surnames: string[]; count: number } {
  if (!authorsStr) return { surnames: [], count: 0 };
  
  const trimmed = authorsStr.trim();
  const surnames: string[] = [];
  
  // Try APA format: "Surname, I., Surname2, I.,"
  const apaMatches = trimmed.match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'''-]+),\s*[A-Za-zÀ-ÿ]\.?/g);
  if (apaMatches && apaMatches.length > 0) {
    for (const match of apaMatches) {
      const surname = match.match(/^([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'''-]+),/);
      if (surname) {
        surnames.push(surname[1]);
      }
    }
    if (surnames.length > 0) {
      return { surnames, count: surnames.length };
    }
  }
  
  // Try splitting by & or "and"
  const parts = trimmed.split(/\s*(?:&|\band\b)\s*/i).filter(Boolean);
  if (parts.length >= 2) {
    for (const part of parts) {
      // Get last word as surname
      const words = part.trim().split(/\s+/).filter(w => w.length > 1 && !/^[A-Z]\.?$/.test(w));
      if (words.length > 0) {
        surnames.push(words[words.length - 1]);
      }
    }
    if (surnames.length > 0) {
      return { surnames, count: surnames.length };
    }
  }
  
  // Fallback: try comma-separated
  const commaParts = trimmed.split(/\s*,\s*/).filter(p => p.length > 2 && !/^\s*[A-Z]\.?\s*$/.test(p));
  if (commaParts.length > 0) {
    // First comma part is likely "Surname, Initial" so take first word
    const firstSurname = commaParts[0].split(/\s+/)[0];
    if (firstSurname && firstSurname.length > 1) {
      surnames.push(firstSurname);
    }
    // For subsequent, take last word
    for (let i = 1; i < commaParts.length; i += 2) {
      const words = commaParts[i].trim().split(/\s+/).filter(w => w.length > 1);
      if (words.length > 0) {
        surnames.push(words[0]); // In APA, each new author starts with surname
      }
    }
    const count = Math.max(1, Math.ceil(commaParts.length / 2));
    return { surnames: surnames.slice(0, count), count };
  }
  
  // Last resort: first word
  const firstWord = trimmed.split(/[\s,]/)[0];
  if (firstWord && firstWord.length > 1) {
    return { surnames: [firstWord], count: 1 };
  }
  
  return { surnames: [], count: 0 };
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
    const { surnames, count } = parseAuthorsString(source.authors);
    const year = source.year.toString();
    
    if (surnames.length > 0) {
      const first = surnames[0];
      
      if (count === 1) {
        // Single author: "Author, 2025"
        variants.push(normalizeCitation(`${first}, ${year}`));
        variants.push(normalizeCitation(`${first} ${year}`));
      } else if (count === 2 && surnames.length >= 2) {
        // Two authors: "Author & Author2, 2025" (APA7 uses both names)
        const second = surnames[1];
        variants.push(normalizeCitation(`${first} & ${second}, ${year}`));
        variants.push(normalizeCitation(`${first} and ${second}, ${year}`));
        // Also add single-author variant as fallback
        variants.push(normalizeCitation(`${first}, ${year}`));
      } else {
        // Three+ authors: "Author et al., 2025"
        variants.push(normalizeCitation(`${first} et al., ${year}`));
        variants.push(normalizeCitation(`${first} et al. ${year}`));
        // Also add single-author variant as fallback
        variants.push(normalizeCitation(`${first}, ${year}`));
      }
    }
  }
  
  return [...new Set(variants)];
}

/**
 * Generate matching keys for a source (used for fast lookup)
 */
function getSourceMatchingKeys(source: Source): string[] {
  const keys: string[] = [];
  
  // From in_text_label
  if (source.in_text_label) {
    keys.push(...getMatchingKey(source.in_text_label));
  }
  
  // From authors + year
  if (source.authors && source.year) {
    const { surnames, count } = parseAuthorsString(source.authors);
    const year = source.year.toString();
    
    if (surnames.length > 0) {
      const firstKey = normalizeAuthorForKey(surnames[0]);
      keys.push(`${firstKey}|${year}`);
      
      if (count === 2 && surnames.length >= 2) {
        const secondKey = normalizeAuthorForKey(surnames[1]);
        keys.push(`${firstKey}+${secondKey}|${year}`);
      }
    }
  }
  
  return [...new Set(keys)];
}

// ============= FUZZY MATCHING =============

/**
 * Simple Levenshtein distance for fuzzy matching
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
 * Try fuzzy matching on author name with sources
 * Allows ±1 year tolerance and partial author name matching
 */
function fuzzyMatchAuthor(
  citationKey: string,
  sourceKeys: Map<string, string>,
  threshold: number = 2
): string | undefined {
  // Parse the citation key: "authorkey|year"
  const [citAuthor, citYear] = citationKey.split('|');
  if (!citAuthor || !citYear) return undefined;
  
  const citYearNum = parseInt(citYear);
  
  for (const [sourceKey, sourceId] of sourceKeys) {
    const [srcAuthor, srcYear] = sourceKey.split('|');
    if (!srcAuthor || !srcYear) continue;
    
    const srcYearNum = parseInt(srcYear);
    
    // Allow ±1 year tolerance for fuzzy matching
    const yearDiff = Math.abs(citYearNum - srcYearNum);
    if (yearDiff > 1) continue;
    
    // Check if citation author is a suffix of source author (e.g., "acqua" in "dellacqua")
    if (srcAuthor.endsWith(citAuthor) && citAuthor.length >= 4) {
      return sourceId;
    }
    
    // Check if source author is a suffix of citation author
    if (citAuthor.endsWith(srcAuthor) && srcAuthor.length >= 4) {
      return sourceId;
    }
    
    // Check prefix match (first 4 chars) - only if years match exactly
    if (yearDiff === 0 && citAuthor.length >= 4 && srcAuthor.length >= 4) {
      if (citAuthor.slice(0, 4) === srcAuthor.slice(0, 4)) {
        return sourceId;
      }
    }
    
    // Check if one contains the other (for compound names)
    if (srcAuthor.includes(citAuthor) && citAuthor.length >= 4) {
      return sourceId;
    }
    if (citAuthor.includes(srcAuthor) && srcAuthor.length >= 4) {
      return sourceId;
    }
    
    // Check Levenshtein distance - only if years match exactly
    if (yearDiff === 0 && levenshteinDistance(citAuthor, srcAuthor) <= threshold) {
      return sourceId;
    }
  }
  
  return undefined;
}

// ============= CORE ANALYSIS =============

export function detectCitations(text: string): Map<string, { raw: string; count: number }> {
  const citations = new Map<string, { raw: string; count: number }>();
  
  const extracted = extractIndividualCitations(text);
  
  for (const citation of extracted) {
    const normalized = normalizeCitation(citation);
    
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
  
  // Build source lookups
  const sourceVariants = new Map<string, string>(); // normalized label -> source id
  const sourceKeys = new Map<string, string>(); // "authorkey|year" -> source id
  
  for (const source of sources) {
    // Add all normalized variants
    const variants = normalizeSourceLabel(source);
    for (const variant of variants) {
      if (variant) {
        sourceVariants.set(variant, source.id);
      }
    }
    
    // Add all matching keys
    const keys = getSourceMatchingKeys(source);
    for (const key of keys) {
      sourceKeys.set(key, source.id);
    }
  }
  
  // Match detected citations against sources
  for (const [normalized, { raw, count }] of detectedMap) {
    let matched = false;
    let matchedSourceId: string | undefined;
    
    // 1. Try exact normalized match
    if (sourceVariants.has(normalized)) {
      matched = true;
      matchedSourceId = sourceVariants.get(normalized);
    }
    
    // 2. Try key-based match
    if (!matched) {
      const citationKeys = getMatchingKey(raw);
      for (const key of citationKeys) {
        if (sourceKeys.has(key)) {
          matched = true;
          matchedSourceId = sourceKeys.get(key);
          break;
        }
      }
    }
    
    // 3. Try fuzzy match on primary key
    if (!matched) {
      const citationKeys = getMatchingKey(raw);
      if (citationKeys.length > 0) {
        const fuzzyMatch = fuzzyMatchAuthor(citationKeys[0], sourceKeys);
        if (fuzzyMatch) {
          matched = true;
          matchedSourceId = fuzzyMatch;
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
 * Get source IDs that are in the library but not cited in the thesis
 */
export function getUnusedSources(analysis: CitationAnalysis, sources: Source[]): Source[] {
  const matchedIds = new Set(
    analysis.detectedCitations
      .filter(c => c.matched && c.matchedSourceId)
      .map(c => c.matchedSourceId!)
  );
  
  return sources.filter(s => !matchedIds.has(s.id));
}

/**
 * Parse a citation string to extract author and year for creating a placeholder source
 */
export function parseCitationForPlaceholder(citation: string): { author: string; year: number | null; label: string } {
  const info = extractAuthorYearInfo(citation);
  
  let label = citation.trim();
  if (!label.startsWith('(')) label = `(${label}`;
  if (!label.endsWith(')')) label = `${label})`;
  
  return {
    author: info?.primaryAuthor || '',
    year: info?.year ? parseInt(info.year, 10) : null,
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
