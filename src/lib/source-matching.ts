import { Source } from "./types";

// Escape special regex characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Find a source by its citation label (e.g., "(Noy & Zhang, 2023)" or "Noy and Zhang (2023)")
 * Uses a scoring system to find the best match considering year, author names, and in-text labels
 */
export function findSourceByLabel(label: string, sources: Source[]): Source | undefined {
  // Extract author name(s) and year from label like "(Noy & Zhang, 2023)" or "Noy and Zhang (2023)"
  const yearMatch = label.match(/\b(19|20)\d{2}[a-z]?\b/);
  const year = yearMatch ? parseInt(yearMatch[0].replace(/[a-z]/g, '')) : null;
  
  // Extract author names - remove year and clean up
  const authorPart = label
    .replace(/\([^)]*\d{4}[^)]*\)/g, '') // Remove parenthetical year
    .replace(/\b(19|20)\d{2}[a-z]?\b/g, '') // Remove standalone years
    .replace(/[()]/g, '')
    .replace(/\bet\s+al\.?\b/gi, '')
    .replace(/[,&]/g, ' ')
    .trim()
    .toLowerCase();
  
  const authorNames = authorPart.split(/\s+/).filter(n => n.length > 2);
  
  // Score each source based on match quality
  let bestMatch: { source: Source; score: number } | null = null;
  let secondBest: { source: Source; score: number } | null = null;
  
  for (const source of sources) {
    let score = 0;
    
    // Year match is critical - must match if both have years
    if (year && source.year) {
      if (source.year === year) {
        score += 50; // Strong boost for year match
      } else {
        continue; // Year mismatch - skip this source
      }
    }
    
    // Check in_text_label exact match (highest priority)
    if (source.in_text_label) {
      const sourceLabel = source.in_text_label.toLowerCase();
      if (sourceLabel === label.toLowerCase() || 
          sourceLabel.replace(/[()]/g, '') === label.toLowerCase().replace(/[()]/g, '')) {
        score += 100;
      }
    }
    
    // Check author name matches with WORD BOUNDARIES to prevent "Smith" matching "Smithson"
    if (source.authors && authorNames.length > 0) {
      const sourceAuthors = source.authors.toLowerCase();
      let authorsMatched = 0;
      
      for (const name of authorNames) {
        if (name.length > 2) {
          // Use word boundary regex for precise matching
          const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
          if (wordBoundaryRegex.test(sourceAuthors)) {
            authorsMatched++;
          }
        }
      }
      
      // Require at least one author name match
      if (authorsMatched > 0) {
        score += authorsMatched * 20;
      }
    }
    
    // Check in_text_label contains author names with word boundaries
    if (source.in_text_label && authorNames.length > 0) {
      const sourceLabel = source.in_text_label.toLowerCase();
      for (const name of authorNames) {
        if (name.length > 2) {
          const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
          if (wordBoundaryRegex.test(sourceLabel)) {
            score += 15;
          }
        }
      }
    }
    
    // Fallback: Check filename for author name or year
    if (score === 0 && source.original_filename) {
      const filenameClean = source.original_filename.toLowerCase().replace(/[-_]/g, ' ');
      for (const name of authorNames) {
        if (name.length > 3 && filenameClean.includes(name)) {
          score += 10;
        }
      }
      if (year && filenameClean.includes(String(year))) {
        score += 10;
      }
    }
    
    // Update best matches
    if (score > 0) {
      if (!bestMatch || score > bestMatch.score) {
        secondBest = bestMatch;
        bestMatch = { source, score };
      } else if (!secondBest || score > secondBest.score) {
        secondBest = { source, score };
      }
    }
  }
  
  // Log ambiguous matches for debugging
  if (bestMatch && secondBest && bestMatch.score - secondBest.score < 20) {
    console.warn(`[findSourceByLabel] Ambiguous source match for "${label}": ` +
      `${bestMatch.source.in_text_label || bestMatch.source.original_filename} (${bestMatch.score}) vs ` +
      `${secondBest.source.in_text_label || secondBest.source.original_filename} (${secondBest.score})`);
  }
  
  // Only return if we have a reasonable match (year + at least one author, or high score)
  if (bestMatch && bestMatch.score >= 70) {
    return bestMatch.source;
  }
  
  // Lower threshold fallback if we have a year match
  if (bestMatch && bestMatch.score >= 50 && year) {
    return bestMatch.source;
  }
  
  return undefined;
}
