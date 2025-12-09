import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';
import pdf from 'https://esm.sh/pdf-parse@1.1.1/lib/pdf-parse.js';

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

    // Download the file
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

    // Determine file type and extract text
    const lowerPath = file_path.toLowerCase();
    let text = '';

    if (lowerPath.endsWith('.pdf')) {
      text = await extractPdfText(fileData);
    } else if (lowerPath.endsWith('.docx')) {
      text = await extractDocxText(fileData);
    } else if (lowerPath.endsWith('.txt')) {
      text = await extractTxtText(fileData);
    } else {
      return new Response(
        JSON.stringify({ error: 'Unsupported file type. Please upload PDF, DOCX, or TXT.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!text || text.length < 100) {
      return new Response(
        JSON.stringify({ 
          error: 'Could not extract text from file',
          message: 'The file may be image-based or corrupted. Please try a different file or manually enter paragraph text.',
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Split into paragraphs
    const paragraphs = splitIntoParagraphs(text);

    console.log(`Extracted ${paragraphs.length} paragraphs from ${text.length} characters`);

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

async function extractPdfText(fileData: Blob): Promise<string> {
  try {
    const arrayBuffer = await fileData.arrayBuffer();
    
    const pdfData = await pdf(arrayBuffer);
    return pdfData.text || '';
  } catch (error) {
    console.error('PDF parse error:', error);
    throw new Error('Failed to parse PDF');
  }
}

async function extractDocxText(fileData: Blob): Promise<string> {
  try {
    const arrayBuffer = await fileData.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    
    // DOCX is a ZIP file containing XML
    // We'll use a simple approach to extract text from the main document
    const { decompress } = await import('https://deno.land/x/zip@v1.2.5/decompress.ts');
    
    // Convert to temp file for decompression
    const tempDir = await Deno.makeTempDir();
    const tempFile = `${tempDir}/doc.docx`;
    await Deno.writeFile(tempFile, buffer);
    
    // Decompress
    await decompress(tempFile, tempDir);
    
    // Read the main document XML
    const documentPath = `${tempDir}/word/document.xml`;
    const xmlContent = await Deno.readTextFile(documentPath);
    
    // Extract text from XML (simple regex approach)
    const textContent = xmlContent
      .replace(/<w:t[^>]*>([^<]*)<\/w:t>/g, '$1 ')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'");
    
    // Cleanup
    try {
      await Deno.remove(tempDir, { recursive: true });
    } catch { /* ignore cleanup errors */ }
    
    return textContent;
  } catch (error) {
    console.error('DOCX parse error:', error);
    throw new Error('Failed to parse DOCX');
  }
}

async function extractTxtText(fileData: Blob): Promise<string> {
  try {
    return await fileData.text();
  } catch (error) {
    console.error('TXT read error:', error);
    throw new Error('Failed to read text file');
  }
}

function splitIntoParagraphs(text: string): string[] {
  // Clean up the text
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/ +/g, ' ');
  
  // Split by double newlines or single newlines followed by indent/capital
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
