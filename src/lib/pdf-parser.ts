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
      const isParagraphBreak = gap > avgLineHeight * 1.8;
      
      // Also detect paragraph break if line starts with indent or special patterns
      const startsWithIndent = /^\s{4,}/.test(line.text);
      const startsWithNumber = /^\d+[\.\)]\s/.test(line.text);
      const startsWithBullet = /^[\-\•\*]\s/.test(line.text);
      
      if (isParagraphBreak || startsWithIndent || startsWithNumber || startsWithBullet) {
        if (currentParagraph.length > 0) {
          allParagraphs.push(currentParagraph.join(' '));
          currentParagraph = [];
        }
      }
      
      currentParagraph.push(line.text);
      lastLineY = line.y + line.height;
    }
    
    // Push remaining paragraph
    if (currentParagraph.length > 0) {
      allParagraphs.push(currentParagraph.join(' '));
    }
    
    // Add page break marker
    allParagraphs.push('\n');
  }
  
  return allParagraphs.join('\n\n');
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
}

// Maximum chunk size in characters (roughly 300-400 words)
const MAX_CHUNK_SIZE = 2000;
// Minimum chunk size to be considered a valid paragraph
const MIN_CHUNK_SIZE = 100;

function splitBySentences(text: string): string[] {
  // Split by sentence-ending punctuation followed by space or end of string
  // This regex keeps the punctuation with the sentence
  const sentencePattern = /(?<=[.!?])\s+(?=[A-Z])/g;
  return text.split(sentencePattern).filter(s => s.trim().length > 0);
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

export function identifyThesisSections(paragraphs: string[]): ThesisSection[] {
  const sections: ThesisSection[] = [];
  
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    
    // Detect chapter
    const chapterMatch = p.match(/^(chapter\s*\d+[:\.\s]*)/i);
    if (chapterMatch) {
      sections.push({
        type: 'chapter',
        title: p.substring(0, 100),
        content: p,
        index: i,
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
      });
      continue;
    }
    
    // Detect common thesis sections
    const commonSections = ['abstract', 'introduction', 'literature review', 'methodology', 'methods', 'results', 'discussion', 'conclusion', 'references', 'bibliography', 'acknowledgements', 'appendix'];
    const lowerP = p.toLowerCase();
    const isCommonSection = commonSections.some(s => lowerP.startsWith(s) && p.length < 100);
    
    if (isCommonSection) {
      sections.push({
        type: 'section',
        title: p,
        content: p,
        index: i,
      });
      continue;
    }
    
    // Regular paragraph
    sections.push({
      type: 'paragraph',
      content: p,
      index: i,
    });
  }
  
  return sections;
}