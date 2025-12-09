import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are "Thesis Source Checker", a strict academic assistant that verifies whether a thesis paragraph is properly supported by its cited sources.

GENERAL PRINCIPLES
- Your job is to test claims against the actual content of the provided document snippets, not to be nice.
- Be conservative: if you're not clearly sure a source supports a claim, say "no clear support found" or "uncertain".
- Never invent content or details that do not appear in the provided snippet text.
- Prefer short, precise excerpts over vague summaries.
- Treat everything as BSc-level academic work: normal expectations for citations, no hand-waving.

INPUT DATA
- One paragraph of thesis text.
- A list of sources. For each source:
  - in_text_label: the exact label (e.g. "(Brynjolfsson et al., 2023)").
  - shorthand_id: a simple key (e.g. BRYNJOLFSSON_2023).
  - title, authors, year if available.

TASK
1. Parse the paragraph:
   - Identify all explicit in-text citations.
   - Break the paragraph into 2–6 atomic claims (distinct factual/quantitative statements).
   - For each claim, list the in-text citations that appear in or at the end of its sentence.

2. For each claim, assign a verdict:
   - "Fully supported by cited source(s)"
   - "Partially supported (some mismatch or missing nuance)"
   - "No clear support found in cited sources"
   - "Unsupported: sources talk about a different topic/context"
   - "Uncertain: document text is not sufficient / not accessible here"

3. It is acceptable to note that a statement is common knowledge (e.g. "LLMs are a type of AI model") and does not strictly require a citation; treat such statements as effectively supported for the purposes of paragraph-level color, but mark them as common knowledge.

4. Provide evidence:
   - For each supported or partially supported claim, list one or more evidence entries with:
     - label: in-text label
     - excerpt: short quote (1–3 sentences or up to ~25 words) that supports the claim
     - page_number: use 0 if you don't know the exact page (do NOT guess page 1)
     - section: section name if you can infer it from the excerpt context (e.g. "Abstract", "Introduction", "Results")

5. For claims with no support, clearly state: "No clear supporting passage found in [LABEL]."

6. Issues and suggestions:
   - Highlight overgeneralisation (e.g. single-company study vs "all firms").
   - Highlight overstatement (e.g. "proves" vs "suggests").
   - Suggest where wording could be softened or where extra citations could be added.

7. Overall paragraph color:
   - "green" = claims are well supported by sources and/or statements are common knowledge.
   - "yellow" = mixed or uncertain support (some partial/uncertain claims).
   - "red" = key claims are unsupported, clearly not found in the sources, or contradicted.

OUTPUT FORMAT
Return ONLY valid JSON of this exact form (no markdown, no explanation):
{
  "summary": "One short paragraph summarising how many claims are fully supported, partially supported, unsupported, etc.",
  "overall_color": "green | yellow | red",
  "claims": [
    {
      "index": 1,
      "text": "<exact claim text>",
      "intended_citations": ["(Brynjolfsson et al., 2023)"],
      "verdict": "<one of the verdicts>",
      "common_knowledge": true/false,
      "evidence": [
        {
          "label": "(Brynjolfsson et al., 2023)",
          "excerpt": "<short excerpt>",
          "page_number": 12,
          "section": "Results"
        }
      ],
      "issues_or_suggestions": ["Example: Soften wording from 'proves' to 'suggests'."]
    }
  ],
  "missing_or_ambiguous_citations": [
    {
      "text": "<statement from paragraph>",
      "note": "Likely needs a citation (e.g. review, textbook, or policy report)."
    }
  ]
}

ROBUSTNESS
- If no relevant snippet is found for a citation, say so explicitly.
- Do not rewrite the thesis paragraph; only analyse and diagnose.
- When in doubt, choose the more cautious verdict.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse request body with error handling
    let paragraph: string;
    let sources: any[];
    
    try {
      const body = await req.json();
      paragraph = body.paragraph;
      sources = body.sources || [];
    } catch (parseError) {
      console.error('Failed to parse request body:', parseError);
      return new Response(
        JSON.stringify({ error: 'Invalid request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!paragraph) {
      return new Response(
        JSON.stringify({ error: 'No paragraph provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const GOOGLE_AI_API_KEY = Deno.env.get('GOOGLE_AI_API_KEY');
    if (!GOOGLE_AI_API_KEY) {
      console.error('GOOGLE_AI_API_KEY not configured');
      return new Response(
        JSON.stringify({ error: 'AI features are unavailable. Please configure the Google API key.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the user message with sources context
    const sourcesContext = sources && sources.length > 0
      ? `\n\nAVAILABLE SOURCES:\n${sources.map((s: any) => 
          `- ${s.in_text_label || s.shorthand_id}: ${s.title || 'Untitled'} by ${s.authors || 'Unknown'} (${s.year || 'n.d.'})`
        ).join('\n')}`
      : '\n\nNo sources available for verification.';

    const userMessage = `PARAGRAPH TO ANALYZE:\n"${paragraph}"${sourcesContext}\n\nAnalyze this paragraph and return the JSON result.`;

    console.log('Calling Google Gemini API for paragraph check...');

    // Use Google's Gemini API directly
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: SYSTEM_PROMPT + "\n\n" + userMessage }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 4096,
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Google Gemini API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again in a moment.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      
      return new Response(
        JSON.stringify({ error: 'AI service temporarily unavailable' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('Gemini response received');
    
    // Extract content from Gemini response format
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      console.error('No content in Gemini response:', JSON.stringify(data));
      return new Response(
        JSON.stringify({ error: 'No response from AI' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse the JSON response
    let result;
    try {
      // Remove any markdown code blocks if present
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      return new Response(
        JSON.stringify({ error: 'Failed to parse AI analysis' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Paragraph check complete:', result.overall_color);

    return new Response(
      JSON.stringify({ result }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('check-paragraph error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
