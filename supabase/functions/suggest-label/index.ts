import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { filename, shorthand_id, citation_style = 'apa7' } = await req.json();

    if (!filename) {
      return new Response(
        JSON.stringify({ error: 'No filename provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      // Gracefully fail - return basic extraction
      const extracted = extractFromFilename(filename, citation_style);
      return new Response(
        JSON.stringify(extracted),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const styleExamples: Record<string, string> = {
      'apa7': '(Smith et al., 2023) or (Smith & Jones, 2023) or (Smith, 2023)',
      'mla9': '(Smith et al. 45) - author and page number, no year in parentheses',
      'chicago': '(Smith et al. 2023) - no comma before year',
      'harvard': '(Smith et al., 2023) - similar to APA',
      'ieee': '[1] - numeric citations in square brackets',
      'vancouver': '(1) - numeric citations in parentheses',
    };

    const prompt = `Analyze this academic PDF filename and extract bibliographic metadata.

Filename: "${filename}"

Citation Style: ${citation_style.toUpperCase()}
Example format: ${styleExamples[citation_style] || styleExamples['apa7']}

Extract the following information from the filename:
1. Author surname(s) - look for names like "Smith", "Johnson_2023", "BrynjolfssonEtAl"
2. Year - look for 4-digit years like 2023, 2022, etc.
3. Title - the remaining descriptive text, properly formatted

For the in-text citation label:
- APA7/Harvard: (Author et al., Year) or (Author & Author, Year) or (Author, Year)
- MLA9: (Author et al.) - no year
- Chicago: (Author et al. Year) - no comma
- IEEE: Leave empty (uses numbers)
- Vancouver: Leave empty (uses numbers)

Return a JSON object with these exact fields:
{
  "authors": "Surname, A., & Surname, B." or "Surname, A., Surname, B., & Surname, C.",
  "year": 2023,
  "title": "The Full Title of the Paper",
  "suggested_label": "(Author et al., 2023)" 
}

If you cannot extract a field with confidence, use null for that field.
Return ONLY valid JSON, no explanation.`;

    console.log('Extracting metadata for:', filename);

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash-lite',
        messages: [
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      console.error('AI gateway error for label suggestion');
      const extracted = extractFromFilename(filename, citation_style);
      return new Response(
        JSON.stringify(extracted),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';

    let result;
    try {
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleanContent);
    } catch {
      // Fall back to filename extraction
      result = extractFromFilename(filename, citation_style);
    }

    console.log('Extracted metadata:', result);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('suggest-label error:', error);
    return new Response(
      JSON.stringify({ suggested_label: '' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
  const cleanName = filename.replace(/\.pdf$/i, '');
  
  // Try to extract year
  const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0]) : undefined;
  
  // Try to extract author names (common patterns)
  // Pattern: "AuthorName_2023" or "Author-Name-2023" or "AuthorEtAl2023"
  let authors: string | undefined;
  let authorSurname: string | undefined;
  
  const patterns = [
    /^([A-Z][a-z]+(?:[A-Z][a-z]+)*)(?:_|\s|-|Et|And)/i,  // CamelCase author
    /^([A-Z][a-z]+)(?:\d{4})/i,  // Name followed by year
    /^([A-Za-z]+)_/,  // Name followed by underscore
  ];
  
  for (const pattern of patterns) {
    const match = cleanName.match(pattern);
    if (match) {
      authorSurname = match[1];
      authors = authorSurname;
      break;
    }
  }
  
  // Check for "et al" pattern
  const hasEtAl = /etal|et\s*al/i.test(cleanName);
  
  // Generate in-text label based on citation style
  let suggested_label: string | undefined;
  
  if (authorSurname && year) {
    switch (citationStyle) {
      case 'apa7':
      case 'harvard':
        suggested_label = hasEtAl 
          ? `(${authorSurname} et al., ${year})`
          : `(${authorSurname}, ${year})`;
        break;
      case 'mla9':
        suggested_label = hasEtAl 
          ? `(${authorSurname} et al.)`
          : `(${authorSurname})`;
        break;
      case 'chicago':
        suggested_label = hasEtAl 
          ? `(${authorSurname} et al. ${year})`
          : `(${authorSurname} ${year})`;
        break;
      case 'ieee':
      case 'vancouver':
        // Numeric styles - don't suggest
        suggested_label = undefined;
        break;
    }
  }
  
  // Try to extract title (remaining text after removing author and year)
  let title = cleanName
    .replace(/\b(19|20)\d{2}\b/g, '')
    .replace(/^[A-Za-z]+(?:_|\s|-|Et|And|etal)/i, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  
  if (title.length < 5) {
    title = cleanName.replace(/[_-]+/g, ' ').trim();
  }
  
  return {
    authors,
    year,
    title: title || undefined,
    suggested_label,
  };
}
