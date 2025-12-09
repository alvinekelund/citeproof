import * as pdfjsLib from 'pdfjs-dist';

// Set up the worker using import.meta.url for Vite compatibility
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  const textParts: string[] = [];
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    
    // Build text with position awareness for paragraph detection
    let lastY: number | null = null;
    let pageLines: string[] = [];
    let currentLine = '';
    
    for (const item of textContent.items as any[]) {
      const y = item.transform[5]; // Y position
      
      // Detect line breaks based on Y position changes
      if (lastY !== null && Math.abs(y - lastY) > 5) {
        if (currentLine.trim()) {
          pageLines.push(currentLine.trim());
        }
        currentLine = '';
        
        // Detect paragraph break (larger Y gap)
        if (Math.abs(y - lastY) > 15) {
          pageLines.push('\n'); // Mark paragraph break
        }
      }
      
      currentLine += item.str;
      lastY = y;
    }
    
    if (currentLine.trim()) {
      pageLines.push(currentLine.trim());
    }
    
    textParts.push(pageLines.join(' ').replace(/ \n /g, '\n\n'));
  }
  
  return textParts.join('\n\n');
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

export function splitIntoParagraphs(text: string): string[] {
  // Normalize line endings
  let cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ');
  
  // Split on double newlines (explicit paragraph breaks from PDF extraction)
  let paragraphs = cleaned.split(/\n\s*\n+/);
  
  // Clean up paragraphs - join internal line breaks within paragraphs
  paragraphs = paragraphs
    .map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0);
  
  // Merge very short segments (headers, page numbers, etc.) with next paragraph
  const merged: string[] = [];
  let carryOver = '';
  
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const combined = carryOver ? carryOver + ' ' + p : p;
    
    // Check if this looks like a header or very short content
    const isShortHeader = combined.length < 80 && !combined.includes('. ');
    const isChapterOrSection = /^(chapter|section|part|\d+\.|\d+\s)/i.test(combined);
    
    if (isShortHeader && !isChapterOrSection && i < paragraphs.length - 1) {
      // Carry over to next paragraph
      carryOver = combined;
    } else if (combined.length >= 50 && hasRealWords(combined)) {
      merged.push(combined);
      carryOver = '';
    } else if (isChapterOrSection && combined.length >= 20) {
      // Keep chapter/section headers
      merged.push(combined);
      carryOver = '';
    } else {
      // Too short, carry over
      carryOver = combined;
    }
  }
  
  // Don't forget any remaining carryOver
  if (carryOver && carryOver.length >= 30) {
    merged.push(carryOver);
  }
  
  return merged;
}

function hasRealWords(text: string): boolean {
  const commonWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'this', 'that', 'with', 'from', 'they', 'will', 'what', 'when', 'there', 'their', 'which', 'about'];
  const lowerText = text.toLowerCase();
  
  let wordCount = 0;
  for (const word of commonWords) {
    if (lowerText.includes(` ${word} `)) {
      wordCount++;
    }
  }
  
  return wordCount >= 2;
}
