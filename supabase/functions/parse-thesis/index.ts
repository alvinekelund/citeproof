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

    // Simple text extraction - lightweight approach to avoid compute limits
    const text = extractPdfTextSimple(bytes);

    if (!text || text.length < 100) {
      return new Response(
        JSON.stringify({ 
          error: 'Could not extract text from PDF',
          message: 'This PDF may be image-based or use advanced encoding. Please manually enter paragraph text.',
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

// Lightweight PDF text extraction - no decompression to avoid compute limits
function extractPdfTextSimple(bytes: Uint8Array): string {
  const decoder = new TextDecoder('latin1');
  const pdfContent = decoder.decode(bytes);
  
  const extractedTexts: string[] = [];
  
  // Method 1: Extract from BT...ET text blocks (uncompressed PDFs)
  const textObjectRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let match;
  
  while ((match = textObjectRegex.exec(pdfContent)) !== null) {
    const block = match[1];
    
    // Extract from Tj operator
    const tjRegex = /\(([^)]+)\)\s*Tj/g;
    let tjMatch;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      const decoded = decodePdfString(tjMatch[1]);
      if (decoded.length > 1) {
        extractedTexts.push(decoded);
      }
    }
    
    // Extract from TJ operator (arrays)
    const tjArrayRegex = /\[((?:[^[\]]*|\[[^\]]*\])*)\]\s*TJ/gi;
    let tjArrayMatch;
    while ((tjArrayMatch = tjArrayRegex.exec(block)) !== null) {
      const arrayContent = tjArrayMatch[1];
      const stringParts = arrayContent.match(/\(([^)]*)\)/g);
      if (stringParts) {
        const combined = stringParts
          .map(p => decodePdfString(p.slice(1, -1)))
          .join('');
        if (combined.length > 1) {
          extractedTexts.push(combined);
        }
      }
    }
  }
  
  // Method 2: Look for readable text sequences in the PDF
  if (extractedTexts.length < 10) {
    // Match longer sequences of readable ASCII
    const asciiRegex = /[\x20-\x7E]{40,}/g;
    let asciiMatch;
    while ((asciiMatch = asciiRegex.exec(pdfContent)) !== null) {
      const text = asciiMatch[0];
      // Filter out PDF commands and binary-looking content
      if (!isPdfCommand(text) && hasRealWords(text) && !extractedTexts.includes(text)) {
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

function decodePdfString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\([()])/g, '$1')
    .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function isPdfCommand(text: string): boolean {
  const commandPatterns = [
    /^\/[A-Z]/i,
    /^\d+\s+\d+\s+obj/,
    /^stream$/,
    /^endstream$/,
    /^endobj$/,
    /<<.*>>/,
    /^xref$/,
    /^trailer$/,
    /^startxref$/,
    /^%%EOF/,
    /\/Type\//,
    /\/Font\//,
    /\/BaseFont\//,
    /\/Encoding\//,
  ];
  
  return commandPatterns.some(p => p.test(text));
}

function hasRealWords(text: string): boolean {
  const commonWords = ['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'this', 'that', 'with', 'from', 'they', 'will', 'what', 'when', 'there', 'their', 'which', 'about'];
  const lowerText = text.toLowerCase();
  
  let wordCount = 0;
  for (const word of commonWords) {
    if (lowerText.includes(` ${word} `)) {
      wordCount++;
    }
  }
  
  return wordCount >= 3;
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(p => p.length > 50 && hasRealWords(p));
}
