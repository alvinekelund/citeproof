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
  
  // Strategy 1: Try splitting on double newlines (explicit paragraph breaks)
  let paragraphs = cleaned.split(/\n\s*\n+/);
  
  // If we got too few paragraphs, try more aggressive splitting
  if (paragraphs.length < 3) {
    // Strategy 2: Split on sentences ending with period followed by newline
    paragraphs = cleaned.split(/\.[\s]*\n(?=[A-Z])/);
    paragraphs = paragraphs.map((p, i) => i < paragraphs.length - 1 ? p + '.' : p);
  }
  
  // If still too few, try splitting on any newlines that start with capital letter
  if (paragraphs.length < 3) {
    paragraphs = cleaned.split(/\n(?=[A-Z])/);
  }
  
  // Clean up paragraphs
  paragraphs = paragraphs
    .map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 0);
  
  // Merge very short paragraphs with next one
  const merged: string[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    
    // If paragraph is very short and there's a next one, merge
    if (p.length < 50 && i < paragraphs.length - 1 && !p.match(/^(chapter|section|\d+\.)/i)) {
      paragraphs[i + 1] = p + ' ' + paragraphs[i + 1];
    } else if (p.length >= 30 && hasRealWords(p)) {
      merged.push(p);
    }
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
