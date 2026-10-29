import { supabase } from "@/integrations/supabase/client";

interface MetadataResult {
  authors?: string;
  year?: number;
  title?: string;
  suggested_label?: string;
}

export async function extractMetadataFromText(
  text: string, 
  filename: string, 
  citationStyle: string = 'apa7'
): Promise<MetadataResult> {
  // Use first ~4000 chars and last ~4000 chars for context
  const firstPart = text.slice(0, 4000);
  const lastPart = text.length > 8000 ? text.slice(-4000) : '';
  const extractedText = firstPart + (lastPart ? '\n...\n' + lastPart : '');
  
  const styleExamples: Record<string, string> = {
    'apa7': '(Smith et al., 2023) or (Smith & Jones, 2023) or (Smith, 2023)',
    'mla9': '(Smith et al. 45) - author and page number, no year in parentheses',
    'chicago': '(Smith et al. 2023) - no comma before year',
    'harvard': '(Smith et al., 2023) - similar to APA',
    'ieee': '[1] - numeric citations in square brackets',
    'vancouver': '(1) - numeric citations in parentheses',
  };

  const prompt = `Analyze this academic document and extract bibliographic metadata.

Filename: "${filename}"
Citation Style: ${citationStyle.toUpperCase()}
Example format: ${styleExamples[citationStyle] || styleExamples['apa7']}

DOCUMENT CONTENT (beginning and end):
---
${extractedText}
---

From the document content, extract:
1. Title - look for the main title at the start of the document
2. Authors - look for author names, usually after the title or in headers
3. Year - look for publication year, copyright notices, or dates
4. For known papers (like "Attention Is All You Need"), use correct attribution

Generate an in-text citation label according to the ${citationStyle.toUpperCase()} style.

Return JSON:
{
  "authors": "Surname, A., et al." or just "Surname, A." for single author,
  "year": 2024,
  "title": "The Full Title of the Paper",
  "suggested_label": "(Author et al., 2024)"
}

Return ONLY valid JSON, no explanation. Use null for fields you cannot determine.`;

  try {
    // Gemini call goes through the ai-chat edge function so the key stays server-side
    const { data, error } = await supabase.functions.invoke('ai-chat', {
      body: { prompt }
    });
    
    if (error) throw error;
    
    const content = data?.content || '';
    const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const result = JSON.parse(cleanContent);
    
    // Clean up null values
    const cleaned: MetadataResult = {};
    if (result.authors) cleaned.authors = result.authors;
    if (result.year) cleaned.year = result.year;
    if (result.title) cleaned.title = result.title;
    if (result.suggested_label) cleaned.suggested_label = result.suggested_label;
    
    return cleaned;
  } catch (error) {
    console.error('Metadata extraction error:', error);
    // Fallback: try to extract from filename
    return extractFromFilename(filename, citationStyle);
  }
}

function extractFromFilename(filename: string, citationStyle: string): MetadataResult {
  const cleanName = filename.replace(/\.(pdf|docx|txt)$/i, '');
  
  let year: number | undefined;
  const yearMatch = cleanName.match(/\b(19|20)\d{2}\b/);
  if (yearMatch) {
    year = parseInt(yearMatch[0]);
  }

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
