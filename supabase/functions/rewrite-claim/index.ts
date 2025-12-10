import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    const { claim, sources, mode } = await req.json();
    
    const GOOGLE_AI_API_KEY = Deno.env.get('GOOGLE_AI_API_KEY');
    if (!GOOGLE_AI_API_KEY) {
      throw new Error('GOOGLE_AI_API_KEY is not configured');
    }

    console.log(`Rewriting claim in ${mode} mode:`, claim.substring(0, 100));

    const sourceList = sources.map((s: any) => 
      `- ${s.in_text_label || s.shorthand_id}: "${s.title}" by ${s.authors} (${s.year})${s.extracted_text ? `\n  Content preview: ${s.extracted_text.substring(0, 2000)}...` : ''}`
    ).join('\n');

    let prompt = '';
    
    if (mode === 'find_source') {
      prompt = `You are an academic writing assistant. A claim in a thesis lacks proper source support.

CLAIM: "${claim}"

AVAILABLE SOURCES IN THE LIBRARY:
${sourceList}

Your task: Find the MOST RELEVANT source from the library that could support this claim, and rewrite the claim to properly cite that source.

Rules:
1. Only use sources from the provided library
2. The rewritten claim must be academically accurate and not overstate the source
3. Use proper in-text citation format matching the source's label
4. Keep the core meaning but adjust wording to match what the source actually supports
5. If no source is truly relevant, suggest softening the claim with hedging language
6. IMPORTANT: Include a direct quote or specific evidence from the source content that supports the claim

Respond with JSON:
{
  "rewritten_claim": "The rewritten sentence with proper citation",
  "suggested_source": "The source label used",
  "evidence": {
    "excerpt": "Direct quote from the source that supports this claim",
    "page_number": 1,
    "section": "Section name if identifiable"
  },
  "explanation": "Brief explanation of the change"
}`;
    } else {
      // mode === 'make_defensible'
      prompt = `You are an academic writing assistant. A claim in a thesis lacks proper source support and needs to be rewritten to be defensible without citing external sources.

CLAIM: "${claim}"

Your task: Rewrite this claim to make it defensible as:
- A logical argument/observation that doesn't require citation
- A methodological statement about the research
- A hedged/qualified claim that acknowledges limitations
- Common knowledge statement (if appropriate)

Rules:
1. Keep the essential meaning but make it self-supporting
2. Use hedging language like "It appears that...", "This suggests...", "Based on the analysis..."
3. Make it clear this is interpretation or observation, not factual claim
4. Keep academic tone

Respond with JSON:
{
  "rewritten_claim": "The rewritten sentence that doesn't require external citation",
  "strategy": "hedging" | "observation" | "methodological" | "logical_argument",
  "explanation": "Brief explanation of the approach"
}`;
    }

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
          temperature: 0.3,
          maxOutputTokens: 2048,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!content) {
      throw new Error('No content in Gemini response');
    }
    
    if (!content) {
      throw new Error('No content in AI response');
    }

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not parse JSON from response');
    }
    
    const result = JSON.parse(jsonMatch[0]);
    console.log('Rewrite result:', result);

    return new Response(JSON.stringify({ result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error: unknown) {
    console.error('Rewrite claim error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
