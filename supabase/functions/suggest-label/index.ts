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
    const { filename, file_path, shorthand_id, citation_style = 'apa7' } = await req.json();

    if (!filename) {
      return new Response(
        JSON.stringify({ error: 'No filename provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing file:', filename, 'path:', file_path, 'style:', citation_style);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let extractedText = '';
    
    // Download and extract text from the PDF if file_path is provided
    if (file_path) {
      try {
        console.log('Downloading file from storage...');
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('thesis-files')
          .download(file_path);

        if (!downloadError && fileData) {
          const lowerPath = file_path.toLowerCase();
          
          if (lowerPath.endsWith('.pdf')) {
            const arrayBuffer = await fileData.arrayBuffer();
            const pdfData = await pdf(arrayBuffer);
            // Get first ~8000 chars for analysis (title pages, abstract, references usually at start/end)
            const fullText = pdfData.text || '';
            const firstPart = fullText.slice(0, 4000);
            const lastPart = fullText.slice(-4000);
            extractedText = firstPart + '\n...\n' + lastPart;
            console.log('Extracted', fullText.length, 'chars from PDF');
          } else if (lowerPath.endsWith('.txt')) {
            extractedText = (await fileData.text()).slice(0, 8000);
          }
        } else {
          console.error('Download error:', downloadError);
        }
      } catch (err) {
        console.error('File extraction error:', err);
      }
    }

    const GOOGLE_AI_API_KEY = Deno.env.get('GOOGLE_AI_API_KEY');
    if (!GOOGLE_AI_API_KEY) {
      // Return basic extraction if no API key
      console.log('No GOOGLE_AI_API_KEY, using fallback extraction');
      const localExtraction = extractFromFilename(filename, citation_style);
      return new Response(
        JSON.stringify(localExtraction),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use AI for better extraction with actual document content
    const styleExamples: Record<string, string> = {
      'apa7': '(Smith et al., 2023) or (Smith & Jones, 2023) or (Smith, 2023)',
      'mla9': '(Smith et al. 45) - author and page number, no year in parentheses',
      'chicago': '(Smith et al. 2023) - no comma before year',
      'harvard': '(Smith et al., 2023) - similar to APA',
      'ieee': '[1] - numeric citations in square brackets',
      'vancouver': '(1) - numeric citations in parentheses',
    };

    const prompt = extractedText 
      ? `Analyze this academic document and extract bibliographic metadata.

Filename: "${filename}"
Citation Style: ${citation_style.toUpperCase()}
Example format: ${styleExamples[citation_style] || styleExamples['apa7']}

DOCUMENT CONTENT (beginning and end):
---
${extractedText}
---

From the document content, extract:
1. Title - look for the main title at the start of the document
2. Authors - look for author names in the ORDER they appear (this reflects contribution order per APA)
3. Year - look for publication year, copyright notices, or dates

IMPORTANT for in-text citation (APA 7th edition):
- Use the FIRST LISTED author's surname (the order reflects contribution, not alphabetical)
- For 1-2 authors: list all names
- For 3+ authors: use "First Author et al."

Return JSON:
{
  "authors": "Surname, A., Surname2, B., etc." in the order listed in the paper,
  "year": 2024,
  "title": "The Full Title of the Paper",
  "suggested_label": "(FirstListedAuthor et al., Year)" - use FIRST LISTED author per APA
}

Return ONLY valid JSON, no explanation. Use null for fields you cannot determine.`
      : `Analyze this academic PDF filename and try to extract bibliographic metadata.

Filename: "${filename}"
Citation Style: ${citation_style.toUpperCase()}
Example format: ${styleExamples[citation_style] || styleExamples['apa7']}

Common patterns:
- "NIPS-2017-attention-is-all-you-need-Paper.pdf" → Vaswani et al., 2017
- "1706.03762.pdf" → arXiv paper
- "author2023title.pdf" → Author (2023)

IMPORTANT: If multiple authors can be inferred, use the FIRST LISTED surname for the in-text label.

Return JSON:
{
  "authors": "Surname, A., et al.",
  "year": 2024,
  "title": "The Full Title",
  "suggested_label": "(Author et al., 2024)"
}

Return ONLY valid JSON, no explanation. Use null for fields you cannot determine.`;

    console.log('Calling Google Gemini API for suggest-label...');

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GOOGLE_AI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: prompt }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      const localExtraction = extractFromFilename(filename, citation_style);
      return new Response(
        JSON.stringify(localExtraction),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    console.log('Gemini response:', content.slice(0, 200));

    let result;
    try {
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleanContent);
      
      // Clean up null values
      if (result.authors === null) delete result.authors;
      if (result.year === null) delete result.year;
      if (result.title === null) delete result.title;
      if (result.suggested_label === null) delete result.suggested_label;
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      result = extractFromFilename(filename, citation_style);
    }

    console.log('Final result:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('suggest-label error:', error);
    return new Response(
      JSON.stringify({ error: 'Extraction failed' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// Fallback extraction from filename
function extractFromFilename(filename: string, citationStyle: string): {
  authors?: string;
  year?: number;
  title?: string;
  suggested_label?: string;
} {
  const cleanName = filename.replace(/\.(pdf|docx|txt)$/i, '');
  
  // Extract year
  let year: number | undefined;
  const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[0]);
  }

  // Extract title from filename
  let title: string | undefined;
  const titlePart = cleanName
    .replace(/^[A-Z]+-\d{4}-/i, '')
    .replace(/-Paper$/i, '')
    .replace(/\b\d{4}\b/g, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (titlePart.length > 5) {
    title = titlePart.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }
  
  return { year, title };
}
