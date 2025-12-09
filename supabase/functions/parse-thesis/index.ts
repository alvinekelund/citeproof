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

    // Extract text from PDF using a simple approach
    // This extracts text between stream markers and decodes it
    const text = extractPdfText(bytes);

    if (!text || text.length < 100) {
      // If extraction failed, return a message
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

function extractPdfText(bytes: Uint8Array): string {
  // Convert bytes to string for processing
  const decoder = new TextDecoder('latin1');
  const pdfContent = decoder.decode(bytes);
  
  const extractedTexts: string[] = [];
  
  // Method 1: Extract text from text objects (BT...ET blocks)
  // This is a simplified approach that works for many PDFs
  const textObjectRegex = /BT\s*([\s\S]*?)\s*ET/g;
  let match;
  
  while ((match = textObjectRegex.exec(pdfContent)) !== null) {
    const block = match[1];
    
    // Extract strings from Tj and TJ operators
    const stringRegex = /\(([^)]*)\)\s*Tj|\[(.*?)\]\s*TJ/g;
    let stringMatch;
    
    while ((stringMatch = stringRegex.exec(block)) !== null) {
      if (stringMatch[1]) {
        // Simple (string) Tj
        extractedTexts.push(decodePdfString(stringMatch[1]));
      } else if (stringMatch[2]) {
        // Array [(string) num (string) ...] TJ
        const arrayContent = stringMatch[2];
        const parts = arrayContent.match(/\(([^)]*)\)/g);
        if (parts) {
          for (const part of parts) {
            extractedTexts.push(decodePdfString(part.slice(1, -1)));
          }
        }
      }
    }
  }
  
  // Method 2: If no text found, try to find readable ASCII sequences
  if (extractedTexts.length === 0) {
    // Look for sequences of printable ASCII characters
    const asciiRegex = /[\x20-\x7E]{20,}/g;
    let asciiMatch;
    while ((asciiMatch = asciiRegex.exec(pdfContent)) !== null) {
      // Filter out PDF commands and binary-looking content
      const text = asciiMatch[0];
      if (!isPdfCommand(text) && hasRealWords(text)) {
        extractedTexts.push(text);
      }
    }
  }
  
  // Join and clean up
  let result = extractedTexts.join(' ');
  
  // Clean up the text
  result = result
    .replace(/\s+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2') // Add space between camelCase
    .replace(/\. ([A-Z])/g, '.\n\n$1') // Paragraph breaks at sentences
    .trim();
  
  return result;
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
