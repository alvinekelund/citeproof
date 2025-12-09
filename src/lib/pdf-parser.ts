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
    const pageText = textContent.items
      .map((item: any) => item.str)
      .join(' ');
    textParts.push(pageText);
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
  
  // Try to find XML text content patterns
  const textMatches = content.match(/<w:t[^>]*>([^<]*)<\/w:t>/g);
  if (textMatches) {
    return textMatches
      .map(match => match.replace(/<[^>]+>/g, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
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
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ');
  
  const rawParagraphs = cleaned.split(/\n\s*\n/);
  
  return rawParagraphs
    .map(p => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 50 && hasRealWords(p));
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
