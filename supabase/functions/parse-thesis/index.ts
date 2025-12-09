import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { file_path } = await req.json();

    if (!file_path) {
      return new Response(
        JSON.stringify({ error: 'No file_path provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Parsing thesis from:', file_path);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Download the PDF file
    const { data: fileData, error: downloadError } = await supabase.storage
      .from('thesis-files')
      .download(file_path);

    if (downloadError || !fileData) {
      console.error('Download error:', downloadError);
      return new Response(
        JSON.stringify({ error: 'Failed to download file' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Convert to array buffer
    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // Extract text from PDF
    const text = await extractPdfText(bytes);

    if (!text || text.length < 100) {
      return new Response(
        JSON.stringify({ 
          error: 'Could not extract text from PDF',
          message: 'This PDF may be image-based or encrypted. Please try a different file or manually enter paragraph text.',
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Split into paragraphs
    const paragraphs = splitIntoParagraphs(text);

    console.log(`Extracted ${paragraphs.length} paragraphs`);

    return new Response(
      JSON.stringify({ 
        paragraphs,
        total: paragraphs.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('parse-thesis error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const decoder = new TextDecoder('latin1');
  const pdfContent = decoder.decode(bytes);
  
  const extractedTexts: string[] = [];
  
  // Method 1: Try to decompress and extract from FlateDecode streams
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let streamMatch;
  
  while ((streamMatch = streamRegex.exec(pdfContent)) !== null) {
    const streamData = streamMatch[1];
    
    // Check if this might be text content by looking for readable patterns after decompression
    try {
      // Try to decompress using DecompressionStream (available in Deno)
      const streamBytes = new Uint8Array(streamData.length);
      for (let i = 0; i < streamData.length; i++) {
        streamBytes[i] = streamData.charCodeAt(i);
      }
      
      try {
        const decompressed = await decompressData(streamBytes);
        const decompressedText = new TextDecoder('latin1').decode(decompressed);
        
        // Extract text from the decompressed content
        const texts = extractTextFromContent(decompressedText);
        if (texts.length > 0) {
          extractedTexts.push(...texts);
        }
      } catch {
        // Not compressed or different compression, try raw
        const texts = extractTextFromContent(streamData);
        if (texts.length > 0) {
          extractedTexts.push(...texts);
        }
      }
    } catch {
      // Skip this stream
    }
  }
  
  // Method 2: Extract text from BT...ET blocks (uncompressed PDFs)
  const textObjectRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let match;
  
  while ((match = textObjectRegex.exec(pdfContent)) !== null) {
    const block = match[1];
    const texts = extractTextFromContent(block);
    if (texts.length > 0) {
      extractedTexts.push(...texts);
    }
  }
  
  // Method 3: If still no text, look for readable ASCII sequences
  if (extractedTexts.length === 0) {
    const asciiRegex = /[\x20-\x7E]{30,}/g;
    let asciiMatch;
    while ((asciiMatch = asciiRegex.exec(pdfContent)) !== null) {
      const text = asciiMatch[0];
      if (!isPdfCommand(text) && hasRealWords(text)) {
        extractedTexts.push(text);
      }
    }
  }
  
  // Join and clean up
  let result = extractedTexts.join(' ');
  
  result = result
    .replace(/\s+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\. ([A-Z])/g, '.\n\n$1')
    .trim();
  
  return result;
}

async function decompressData(data: Uint8Array): Promise<Uint8Array> {
  // Use pako-style zlib decompression via DecompressionStream
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  
  // Skip zlib header (first 2 bytes) if present
  const startOffset = (data[0] === 0x78) ? 2 : 0;
  const inputData = data.slice(startOffset);
  
  writer.write(inputData);
  writer.close();
  
  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  
  return result;
}

function extractTextFromContent(content: string): string[] {
  const texts: string[] = [];
  
  // Extract from Tj operator: (text) Tj
  const tjRegex = /\(([^)]+)\)\s*Tj/g;
  let tjMatch;
  while ((tjMatch = tjRegex.exec(content)) !== null) {
    const decoded = decodePdfString(tjMatch[1]);
    if (decoded.length > 1) {
      texts.push(decoded);
    }
  }
  
  // Extract from TJ operator: [(text) num (text) ...] TJ
  const tjArrayRegex = /\[((?:[^[\]]*|\[[^\]]*\])*)\]\s*TJ/gi;
  let tjArrayMatch;
  while ((tjArrayMatch = tjArrayRegex.exec(content)) !== null) {
    const arrayContent = tjArrayMatch[1];
    const stringParts = arrayContent.match(/\(([^)]*)\)/g);
    if (stringParts) {
      const combined = stringParts
        .map(p => decodePdfString(p.slice(1, -1)))
        .join('');
      if (combined.length > 1) {
        texts.push(combined);
      }
    }
  }
  
  return texts;
}

function decodePdfString(str: string): string {
  // Handle PDF escape sequences
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\([()])/g, '$1')
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function isPdfCommand(text: string): boolean {
  // Check if text looks like PDF commands
  const commandPatterns = [
    /^\/[A-Z]/,
    /^\d+\s+\d+\s+obj/,
    /^stream$/,
    /^endstream$/,
    /^endobj$/,
    /<<.*>>/,
    /^xref$/,
    /^trailer$/,
  ];
  
  return commandPatterns.some(p => p.test(text));
}

function hasRealWords(text: string): boolean {
  // Check if text contains real English words
  const commonWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out'];
  const lowerText = text.toLowerCase();
  
  let wordCount = 0;
  for (const word of commonWords) {
    if (lowerText.includes(` ${word} `)) {
      wordCount++;
    }
  }
  
  return wordCount >= 2;
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 50 && hasRealWords(p));
}
