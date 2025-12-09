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

    console.log('Processing filename:', filename, 'style:', citation_style);

    // First try local extraction for common patterns
    const localExtraction = extractFromFilename(filename, citation_style);
    console.log('Local extraction result:', localExtraction);

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      // Return local extraction if no API key
      return new Response(
        JSON.stringify(localExtraction),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use AI for better extraction
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

Common filename patterns to recognize:
- Conference papers: "NIPS-2017-attention-is-all-you-need-Paper.pdf" → Vaswani et al., 2017, "Attention Is All You Need"
- ArXiv papers: "1706.03762v7.pdf" → Look for arXiv ID pattern
- Publisher IDs: "978-3-031-72781-8.pdf" → ISBN, may need generic title
- HBS/working papers: "24-013_xxx.pdf" → Working paper format

Extract:
1. Authors - convert "attention-is-all-you-need" to known paper authorship if recognizable
2. Year - from filename or context (NIPS-2017 means 2017)
3. Title - expand abbreviations and format properly

For well-known papers like "Attention Is All You Need", use the actual author names (Vaswani et al.).

Return JSON:
{
  "authors": "Surname, A." or "Surname, A., et al.",
  "year": 2017,
  "title": "The Full Title",
  "suggested_label": "(Vaswani et al., 2017)"
}

Return ONLY valid JSON, no explanation. Use null for fields you cannot determine.`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'user', content: prompt }
        ],
      }),
    });

    if (!response.ok) {
      console.error('AI gateway error:', response.status);
      return new Response(
        JSON.stringify(localExtraction),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '';

    console.log('AI response:', content);

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
      result = localExtraction;
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

// Enhanced fallback extraction from filename
function extractFromFilename(filename: string, citationStyle: string): {
  authors?: string;
  year?: number;
  title?: string;
  suggested_label?: string;
} {
  const cleanName = filename.replace(/\.pdf$/i, '');
  
  // Known paper patterns
  const knownPapers: Record<string, { authors: string; year: number; title: string }> = {
    'attention-is-all-you-need': { authors: 'Vaswani, A., et al.', year: 2017, title: 'Attention Is All You Need' },
    '1706.03762': { authors: 'Vaswani, A., et al.', year: 2017, title: 'Attention Is All You Need' },
  };

  // Check for known papers
  const lowerName = cleanName.toLowerCase();
  for (const [pattern, data] of Object.entries(knownPapers)) {
    if (lowerName.includes(pattern)) {
      const label = formatLabel(data.authors.split(',')[0].trim(), data.year, citationStyle, true);
      return { ...data, suggested_label: label };
    }
  }

  // Extract year from various patterns
  let year: number | undefined;
  const yearPatterns = [
    /\b(19|20)\d{2}\b/,  // Plain year
    /-(\d{4})-/,         // Year between dashes
    /_(\d{4})_/,         // Year between underscores
  ];
  
  for (const pattern of yearPatterns) {
    const match = cleanName.match(pattern);
    if (match) {
      const potentialYear = parseInt(match[1] || match[0]);
      if (potentialYear >= 1900 && potentialYear <= 2030) {
        year = potentialYear;
        break;
      }
    }
  }

  // Extract title from hyphenated or underscored names
  let title: string | undefined;
  const titlePart = cleanName
    .replace(/^[A-Z]+-\d{4}-/i, '')  // Remove "NIPS-2017-" prefix
    .replace(/-Paper$/i, '')         // Remove "-Paper" suffix
    .replace(/\b\d{4}\b/g, '')       // Remove years
    .replace(/[-_]+/g, ' ')          // Replace separators with spaces
    .replace(/\s+/g, ' ')            // Normalize spaces
    .trim();
  
  if (titlePart.length > 5) {
    // Title case the extracted title
    title = titlePart.split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  // Try to extract author from beginning of filename
  let authors: string | undefined;
  let authorSurname: string | undefined;
  
  const authorPatterns = [
    /^([A-Z][a-z]+)(?:EtAl|_et_al|And)/i,
    /^([A-Z][a-z]+)(?:\d{4})/i,
    /^([A-Z][a-z]+)[-_]/,
  ];
  
  for (const pattern of authorPatterns) {
    const match = cleanName.match(pattern);
    if (match && match[1].length > 2) {
      authorSurname = match[1];
      authors = authorSurname;
      break;
    }
  }

  const hasEtAl = /etal|et\s*al/i.test(cleanName);

  // Generate label
  let suggested_label: string | undefined;
  if (authorSurname && year) {
    suggested_label = formatLabel(authorSurname, year, citationStyle, hasEtAl);
  }
  
  return {
    authors,
    year,
    title,
    suggested_label,
  };
}

function formatLabel(author: string, year: number, style: string, hasEtAl: boolean): string {
  const etAl = hasEtAl ? ' et al.' : '';
  
  switch (style) {
    case 'apa7':
    case 'harvard':
      return `(${author}${etAl}, ${year})`;
    case 'mla9':
      return `(${author}${etAl})`;
    case 'chicago':
      return `(${author}${etAl} ${year})`;
    case 'ieee':
    case 'vancouver':
      return ''; // Numeric styles
    default:
      return `(${author}${etAl}, ${year})`;
  }
}
