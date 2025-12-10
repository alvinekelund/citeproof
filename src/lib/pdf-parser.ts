import * as pdfjsLib from 'pdfjs-dist';

// Set up the worker using import.meta.url for Vite compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface TextItem {
  str: string;
  transform: number[];
  height: number;
}

// Common abbreviations that shouldn't break sentences
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'sr', 'jr', 'vs', 'etc', 'al', 'eg', 'ie',
  'inc', 'ltd', 'co', 'corp', 'fig', 'vol', 'no', 'pp', 'ed', 'eds', 'rev',
  'st', 'ave', 'blvd', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep',
  'oct', 'nov', 'dec', 'approx', 'est', 'dept', 'univ', 'assoc', 'natl', 'intl',
  // Academic-specific abbreviations
  'cf', 'ibid', 'op', 'cit', 'loc', 'et', 'seq', 'sic', 'viz', 'ca',
  'esp', 'trans', 'orig', 'repr', 'ser', 'suppl', 'pt', 'ch', 'sec',
]);

export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  const allParagraphs: string[] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });
    
    // Group text items by lines based on Y position
    const lines: { y: number; text: string; height: number }[] = [];
    let currentLine = '';
    let currentY: number | null = null;
    let currentHeight = 0;
    
    for (const item of textContent.items as TextItem[]) {
      const y = viewport.height - item.transform[5]; // Flip Y to top-down
      const lineHeight = item.height || 12;
      
      // If this is a new line (different Y position)
      if (currentY !== null && Math.abs(y - currentY) > lineHeight * 0.5) {
        if (currentLine.trim()) {
          lines.push({ y: currentY, text: currentLine.trim(), height: currentHeight });
        }
        currentLine = item.str;
        currentY = y;
        currentHeight = lineHeight;
      } else {
        currentLine += item.str;
        if (currentY === null) currentY = y;
        currentHeight = Math.max(currentHeight, lineHeight);
      }
    }
    
    // Don't forget the last line
    if (currentLine.trim() && currentY !== null) {
      lines.push({ y: currentY, text: currentLine.trim(), height: currentHeight });
    }
    
    // Now group lines into paragraphs based on vertical gaps
    let currentParagraph: string[] = [];
    let lastLineY: number | null = null;
    let avgLineHeight = lines.reduce((sum, l) => sum + l.height, 0) / (lines.length || 1);
    
    for (const line of lines) {
      // Detect paragraph break: gap > 1.5x average line height
      const gap = lastLineY !== null ? line.y - lastLineY : 0;
      const isParagraphBreak = gap > avgLineHeight * 1.5; // Reduced from 1.8 for better sensitivity
      
      // Also detect paragraph break if line starts with indent or special patterns
      const startsWithIndent = /^\s{4,}/.test(line.text);
      const startsWithNumber = /^\d+[\.\)]\s/.test(line.text);
      const startsWithBullet = /^[\-\•\*]\s/.test(line.text);
      
      if (isParagraphBreak || startsWithIndent || startsWithNumber || startsWithBullet) {
        if (currentParagraph.length > 0) {
          allParagraphs.push(joinParagraphLines(currentParagraph));
          currentParagraph = [];
        }
      }
      
      currentParagraph.push(line.text);
      lastLineY = line.y + line.height;
    }
    
    // Push remaining paragraph
    if (currentParagraph.length > 0) {
      allParagraphs.push(joinParagraphLines(currentParagraph));
    }
    
    // Add page break marker
    allParagraphs.push('\n');
  }
  
  return allParagraphs.join('\n\n');
}

// Handle hyphenation at line breaks
function joinParagraphLines(lines: string[]): string {
  let result = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = lines[i + 1];
    
    // Check for hyphenation (word split across lines)
    if (line.endsWith('-') && nextLine && /^[a-z]/.test(nextLine)) {
      // Remove hyphen and join with next line
      result += line.slice(0, -1);
    } else {
      result += (result ? ' ' : '') + line;
    }
  }
  return result;
}

export async function extractTextFromDocx(file: File): Promise<string> {
  // DOCX is a ZIP containing XML - use a simple extraction approach
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Look for the document.xml content within the zip
  const decoder = new TextDecoder('utf-8');
  const content = decoder.decode(uint8Array);
  
  // Try to find XML text content patterns, preserving paragraph breaks
  const paragraphMatches = content.match(/<w:p[^>]*>[\s\S]*?<\/w:p>/g);
  if (paragraphMatches) {
    return paragraphMatches
      .map(para => {
        const textMatches = para.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
        if (textMatches) {
          return textMatches
            .map(match => match.replace(/<[^>]+>/g, ''))
            .join('');
        }
        return '';
      })
      .filter(p => p.trim())
      .join('\n\n');
  }
  
  return '';
}

export async function extractTextFromTxt(file: File): Promise<string> {
  return await file.text();
}

export async function extractTextFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  
  if (name.endsWith('.pdf')) {
    return extractTextFromPdf(file);
  } else if (name.endsWith('.docx')) {
    return extractTextFromDocx(file);
  } else if (name.endsWith('.txt')) {
    return extractTextFromTxt(file);
  }
  
  throw new Error('Unsupported file type');
}

export interface ThesisSection {
  type: 'chapter' | 'section' | 'subsection' | 'paragraph';
  title?: string;
  content: string;
  index: number;
  shouldCheck: boolean; // Whether this section needs AI verification
  skipReason?: string; // Reason for skipping (if shouldCheck is false)
}

// Maximum chunk size in characters (roughly 300-400 words)
const MAX_CHUNK_SIZE = 2000;
// Minimum chunk size to be considered a valid paragraph
const MIN_CHUNK_SIZE = 150; // Increased from 100

// Check if word is an abbreviation
function isAbbreviation(word: string): boolean {
  return ABBREVIATIONS.has(word.toLowerCase().replace(/\.$/, ''));
}

function splitBySentences(text: string): string[] {
  const sentences: string[] = [];
  let current = '';
  let i = 0;
  
  while (i < text.length) {
    current += text[i];
    
    // Check for sentence-ending punctuation
    if (['.', '!', '?'].includes(text[i])) {
      // Look ahead for space and capital letter
      const nextChar = text[i + 1];
      const afterNext = text[i + 2];
      
      if (nextChar === ' ' && afterNext && /[A-Z]/.test(afterNext)) {
        // Check if this is an abbreviation
        const words = current.trim().split(/\s+/);
        const lastWord = words[words.length - 1].replace(/[.!?]$/, '');
        
        // Don't split if it's an abbreviation
        if (!isAbbreviation(lastWord)) {
          // Don't split inside citations like (Author et al., 2023)
          const openParens = (current.match(/\(/g) || []).length;
          const closeParens = (current.match(/\)/g) || []).length;
          
          if (openParens === closeParens) {
            sentences.push(current.trim());
            current = '';
            i++; // Skip the space
          }
        }
      }
    }
    
    i++;
  }
  
  if (current.trim()) {
    sentences.push(current.trim());
  }
  
  return sentences.filter(s => s.length > 0);
}

function chunkSentencesIntoPargrahs(sentences: string[], maxSize: number): string[] {
  const chunks: string[] = [];
  let currentChunk = '';
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    if (!trimmedSentence) continue;
    
    // If adding this sentence would exceed max size, save current chunk first
    if (currentChunk && (currentChunk.length + trimmedSentence.length + 1) > maxSize) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }
    
    // If a single sentence is longer than max size, we have to include it anyway
    // but we'll add it as its own chunk
    if (trimmedSentence.length > maxSize && !currentChunk) {
      chunks.push(trimmedSentence);
      continue;
    }
    
    currentChunk = currentChunk ? currentChunk + ' ' + trimmedSentence : trimmedSentence;
  }
  
  // Don't forget the last chunk
  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }
  
  return chunks;
}

// Check if text ends with incomplete sentence (no terminal punctuation)
function endsIncomplete(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  
  // Check for proper sentence-ending punctuation
  // Allow closing quotes/parens after punctuation: ." .) ?) ;"
  const endPattern = /[.!?]["'\)]*$/;
  if (endPattern.test(trimmed)) {
    // But check if the period is part of an abbreviation
    const lastWord = trimmed.split(/\s+/).pop() || '';
    const wordWithoutPunctuation = lastWord.replace(/[.!?"'\)]+$/, '').toLowerCase();
    if (ABBREVIATIONS.has(wordWithoutPunctuation)) {
      return true; // Ends with abbreviation, likely incomplete
    }
    return false; // Ends with proper punctuation
  }
  
  // Check if ends mid-citation like "(Author et al."
  if (/\([^)]+$/.test(trimmed)) {
    return true; // Unclosed parenthesis
  }
  
  // Check if ends with a word (likely mid-sentence)
  const lastWord = trimmed.split(/\s+/).pop() || '';
  // Short words like "a", "the", "an", "as" are strong indicators of incomplete sentence
  if (/^(a|an|the|as|or|and|but|in|on|to|of|for|is|are|was|were|be|been|being|with|by|from|that|this|which|who|what|where|when|how|why)$/i.test(lastWord)) {
    return true;
  }
  
  // Numbers followed by common patterns
  if (/\d+$/.test(lastWord) && !/\d{4}\)?$/.test(trimmed)) {
    // Ends with number but not a year in parentheses - likely incomplete
    return true;
  }
  
  // Any text not ending in sentence-final punctuation is incomplete
  return true;
}

export function splitIntoParagraphs(text: string): string[] {
  // Normalize line endings
  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ');
  
  // Split on double newlines (paragraph breaks)
  let rawParagraphs = cleaned.split(/\n\s*\n+/);
  
  // Clean up paragraphs
  rawParagraphs = rawParagraphs
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0 && p !== '\n');
  
  // Process and chunk
  const result: string[] = [];
  let carryOver = '';
  
  for (let i = 0; i < rawParagraphs.length; i++) {
    const p = rawParagraphs[i];
    const combined = carryOver ? carryOver + ' ' + p : p;
    
    // Skip page numbers, headers, footers
    if (/^page\s*\d+$/i.test(combined) || /^\d+$/.test(combined)) {
      continue;
    }
    
    // Check if this is a section header
    const isSectionHeader = /^(chapter|section|part|abstract|introduction|conclusion|references|bibliography|\d+[\.\)]\s*[A-Z])/i.test(combined);
    
    // If it's a section header, add it as-is
    if (isSectionHeader && combined.length < 200) {
      if (carryOver) {
        // Push any carried over content first
        result.push(carryOver);
        carryOver = '';
      }
      result.push(combined);
      continue;
    }
    
    // If combined text is too short, carry it over
    if (combined.length < MIN_CHUNK_SIZE) {
      carryOver = combined;
      continue;
    }
    
    // Check if paragraph ends incomplete and should merge with next
    if (endsIncomplete(combined) && i + 1 < rawParagraphs.length) {
      const nextP = rawParagraphs[i + 1];
      // Merge if:
      // 1. Next paragraph starts with lowercase (continuation)
      // 2. Or current ends with a short word like "a", "the", etc.
      const endsWithShortWord = /\s(a|an|the|as|or|and|but|in|on|to|of|for|is|are|was|were|be|been|being)$/i.test(combined);
      if (nextP && (/^[a-z]/.test(nextP) || endsWithShortWord)) {
        carryOver = combined;
        continue;
      }
    }
    
    carryOver = '';
    
    // If the paragraph is within acceptable size, add it
    if (combined.length <= MAX_CHUNK_SIZE) {
      // Ensure it ends with proper punctuation (complete sentences)
      const sentences = splitBySentences(combined);
      if (sentences.length > 0) {
        result.push(combined);
      }
    } else {
      // Paragraph is too long - split by sentences respecting max size
      const sentences = splitBySentences(combined);
      const chunks = chunkSentencesIntoPargrahs(sentences, MAX_CHUNK_SIZE);
      
      for (const chunk of chunks) {
        if (chunk.length >= MIN_CHUNK_SIZE) {
          result.push(chunk);
        } else if (result.length > 0) {
          // Append short chunks to the previous result if possible
          const lastIdx = result.length - 1;
          if (result[lastIdx].length + chunk.length + 1 <= MAX_CHUNK_SIZE) {
            result[lastIdx] = result[lastIdx] + ' ' + chunk;
          } else {
            result.push(chunk);
          }
        } else {
          carryOver = chunk;
        }
      }
    }
  }
  
  // Push any remaining content
  if (carryOver.length >= 50) {
    result.push(carryOver);
  }
  
  return result;
}

// Sections that typically don't need citation verification
const NON_CHECKABLE_SECTIONS = [
  'abstract',
  'acknowledgements',
  'acknowledgments', 
  'table of contents',
  'list of figures',
  'list of tables',
  'list of abbreviations',
  'abbreviations',
  'glossary',
  'references',
  'bibliography',
  'appendix',
  'appendices',
  'declaration',
  'dedication',
  'preface',
  'contents',
  'foreword',
];

// Check if text looks like a reference/bibliography entry
function isReferenceEntry(text: string): boolean {
  const lowerText = text.toLowerCase();
  
  // DOI patterns
  if (/doi[:\.]?\s*10\.\d+/i.test(text) || /doi\.org\/10\.\d+/i.test(text)) {
    return true;
  }
  
  // URL patterns (http/https links are common in references)
  if (/https?:\/\/[^\s]+/.test(text) && text.length < 500) {
    return true;
  }
  
  // Standard reference patterns: [1] Author, "Title", etc.
  if (/^\[?\d+\]?\s*[A-Z][a-z]+,?\s+[A-Z]\.?/.test(text)) {
    return true;
  }
  
  // Author-year patterns: Smith, J. (2023). Title...
  if (/^[A-Z][a-z]+,\s*[A-Z]\.?\s*(?:&|,|and)\s*[A-Z][a-z]+|^[A-Z][a-z]+,\s*[A-Z]\.?\s*\(\d{4}\)/.test(text)) {
    return true;
  }
  
  // Journal citation indicators
  const journalPatterns = [
    'journal of', 'proceedings of', 'vol.', 'volume', 'issue', 'pp.', 'pages',
    'isbn', 'issn', 'retrieved from', 'accessed', 'available at'
  ];
  const matchCount = journalPatterns.filter(p => lowerText.includes(p)).length;
  if (matchCount >= 2) {
    return true;
  }
  
  // Numbered reference format: 102982. or [102982]
  if (/^\[?\d{3,}\]?\.?\s/.test(text.trim())) {
    return true;
  }
  
  return false;
}

// Check if paragraph is predominantly citations (>60% citation-like content)
function isPurelyCitationList(text: string): boolean {
  const lines = text.split(/[\n;]/).filter(l => l.trim().length > 10);
  if (lines.length === 0) return false;
  
  let citationLikeLines = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // Check for various citation patterns
    if (
      isReferenceEntry(trimmed) ||
      /^\(\s*[A-Z][a-z]+.*\d{4}\s*\)/.test(trimmed) || // (Author, 2023)
      /^\[[^\]]+\]$/.test(trimmed) // Just a [citation]
    ) {
      citationLikeLines++;
    }
  }
  
  return citationLikeLines / lines.length > 0.6;
}

// Citation patterns to detect - more conservative to avoid false negatives
const CITATION_PATTERNS = [
  /\([^)]*\d{4}[a-z]?[^)]*\)/g,  // Any parentheses containing a year (very broad)
  /\[[0-9,\s\-–]+\]/g,  // [1] or [1, 2] or [1-5]
  /[A-Z][a-z]+\s+(?:et\s+al\.?\s*)?\(\d{4}[a-z]?\)/g,  // Author (2023) or Author et al. (2023)
];

// Check if text contains any citations - be conservative (only skip if definitely no citations)
export function hasCitations(text: string): boolean {
  // Quick check: if text contains a 4-digit year in parentheses, likely has citations
  if (/\([^)]*\b(19|20)\d{2}\b[^)]*\)/.test(text)) {
    return true;
  }
  
  // Check for numbered citations
  if (/\[\d+\]/.test(text)) {
    return true;
  }
  
  // Check for "et al" which is a strong indicator of citations
  if (/et\s+al\.?/i.test(text)) {
    return true;
  }
  
  // Check standard patterns
  for (const pattern of CITATION_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      return true;
    }
  }
  
  return false;
}

// Check if text is within a non-checkable section
function isNonCheckableContent(text: string): boolean {
  const lowerText = text.toLowerCase().trim();
  
  // Section headers themselves
  if (NON_CHECKABLE_SECTIONS.some(s => lowerText.startsWith(s) && text.length < 100)) {
    return true;
  }
  
  // Check if it's a reference entry
  if (isReferenceEntry(text)) {
    return true;
  }
  
  // Check if it's a pure citation list
  if (isPurelyCitationList(text)) {
    return true;
  }
  
  return false;
}

export function identifyThesisSections(paragraphs: string[]): ThesisSection[] {
  const sections: ThesisSection[] = [];
  let currentNonCheckableSection = false;
  let currentNonCheckableSectionName = '';
  
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const lowerP = p.toLowerCase().trim();
    
    // Check if entering a non-checkable section
    const matchedNonCheckable = NON_CHECKABLE_SECTIONS.find(s => lowerP.startsWith(s) && p.length < 100);
    
    // Check if entering a checkable section (resets non-checkable mode)
    const checkableSections = ['introduction', 'literature review', 'methodology', 'methods', 'results', 'discussion', 'conclusion', 'findings', 'analysis'];
    const isCheckableHeader = checkableSections.some(s => lowerP.startsWith(s) && p.length < 100);
    
    if (matchedNonCheckable) {
      currentNonCheckableSection = true;
      currentNonCheckableSectionName = matchedNonCheckable.charAt(0).toUpperCase() + matchedNonCheckable.slice(1);
    } else if (isCheckableHeader || /^(chapter\s*\d+)/i.test(p)) {
      currentNonCheckableSection = false;
      currentNonCheckableSectionName = '';
    }
    
    // Detect chapter
    const chapterMatch = p.match(/^(chapter\s*\d+[:\.\s]*)/i);
    if (chapterMatch) {
      sections.push({
        type: 'chapter',
        title: p.substring(0, 100),
        content: p,
        index: i,
        shouldCheck: false, // Headers don't need checking
        skipReason: 'Section header',
      });
      continue;
    }
    
    // Detect section headers (numbered sections like "1.1 Introduction")
    const sectionMatch = p.match(/^(\d+\.?\d*[\.\)]\s*[A-Z])/);
    if (sectionMatch && p.length < 200) {
      sections.push({
        type: 'section',
        title: p,
        content: p,
        index: i,
        shouldCheck: false, // Headers don't need checking
        skipReason: 'Section header',
      });
      continue;
    }
    
    // Detect common thesis sections
    const commonSections = ['abstract', 'introduction', 'literature review', 'methodology', 'methods', 'results', 'discussion', 'conclusion', 'references', 'bibliography', 'acknowledgements', 'appendix'];
    const isCommonSection = commonSections.some(s => lowerP.startsWith(s) && p.length < 100);
    
    if (isCommonSection) {
      sections.push({
        type: 'section',
        title: p,
        content: p,
        index: i,
        shouldCheck: false, // Headers don't need checking
        skipReason: 'Section header',
      });
      continue;
    }
    
    // Check if paragraph should be verified
    let shouldCheck = true;
    let skipReason: string | undefined;
    
    if (currentNonCheckableSection) {
      shouldCheck = false;
      skipReason = `Part of ${currentNonCheckableSectionName} section`;
    } else if (isNonCheckableContent(p)) {
      shouldCheck = false;
      skipReason = 'Non-checkable content (reference entry or citation list)';
    } else if (!hasCitations(p)) {
      // No citations detected - mark as blue
      shouldCheck = false;
      skipReason = 'No citations detected';
    }
    
    sections.push({
      type: 'paragraph',
      content: p,
      index: i,
      shouldCheck,
      skipReason,
    });
  }
  
  return sections;
}
