import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are "Citeproof", an accurate and fair academic assistant that verifies whether a thesis paragraph is properly supported by its cited sources.

GENERAL PRINCIPLES
- Your job is to accurately assess whether claims are supported by the provided sources.
- Be fair and balanced: acknowledge support when it exists, but flag genuine gaps.
- Search through the ENTIRE source text provided, not just the beginning or first page.
- Never invent content or details that do not appear in the provided source text.
- Prefer short, precise excerpts over vague summaries.
- Treat everything as BSc-level academic work.

CRITICAL RULE - EVIDENCE MUST MATCH CITATIONS:
- For each claim, you MUST only provide evidence from sources that are listed in that claim's "intended_citations".
- NEVER provide evidence from a source that is NOT cited in the claim.
- If a claim cites "(Noy & Zhang, 2023)", only search for evidence in the source with label "(Noy & Zhang, 2023)".
- If you cannot find supporting evidence in the CITED source, mark as unsupported - do NOT use evidence from other sources.
- This is essential for academic integrity: evidence must come from the source the author cited, not from other sources.

SPECIAL HANDLING
- If a paragraph appears to be a REFERENCE LIST or BIBLIOGRAPHY entry (contains DOI, URL, author-year format, journal names), return overall_color "blue" and skip detailed analysis.
- If NO sources have any text content (all extracted_text fields are empty or missing), mark overall_color as "yellow" with verdict "Uncertain: source documents not available for verification" - do NOT mark as red/unsupported.

INPUT DATA
- One paragraph of thesis text.
- A list of sources with their FULL EXTRACTED TEXT. For each source:
  - in_text_label: the exact label (e.g. "(Brynjolfsson et al., 2023)").
  - shorthand_id: a simple key (e.g. BRYNJOLFSSON_2023).
  - title, authors, year if available.
  - extracted_text: The FULL text content of the source document (all pages).

TASK
1. First, check if this paragraph is a reference/bibliography entry. If so, return blue and skip.

2. Parse the paragraph:
   - Identify all explicit in-text citations.
   - Break the paragraph into 2–6 atomic claims (distinct factual/quantitative statements).
   - For each claim, list the in-text citations that appear in or at the end of its sentence.

3. For each claim, SEARCH the ENTIRE extracted_text of the relevant source(s) to find supporting evidence:
   - Look through ALL pages of the source, not just the first page
   - Search for keywords, concepts, and related terminology
   - Be thorough: evidence may use different wording than the claim
   - Assign a verdict:
     - "Fully supported by cited source(s)" - if you find clear evidence in the source text
     - "Partially supported (some mismatch or missing nuance)"
     - "No clear support found in cited sources" - only if you searched thoroughly and found nothing
     - "Unsupported: sources talk about a different topic/context"
     - "Uncertain: source text not available for verification" - if the source has no/empty extracted_text

4. It is acceptable to note that a statement is common knowledge (e.g. "LLMs are a type of AI model") and does not strictly require a citation; treat such statements as effectively supported for the purposes of paragraph-level color, but mark them as common knowledge.

5. Provide evidence:
   - CRITICAL: Only provide evidence from sources listed in the claim's intended_citations!
   - The evidence "label" MUST exactly match one of the intended_citations for that claim.
   - For each supported or partially supported claim, list one or more evidence entries with:
     - label: in-text label (MUST be from intended_citations)
     - excerpt: short quote (1–3 sentences or up to ~50 words) from the source's extracted_text that supports the claim
     - page_number: estimate based on position in text if possible, or use 0 if unknown
     - section: section name if you can infer it from the excerpt context

6. For claims with no support, clearly state: "No clear supporting passage found in [LABEL]." - do NOT substitute evidence from other sources.

7. Issues and suggestions:
   - Only flag genuine issues (overgeneralisation, overstatement, missing citation for non-common-knowledge claims).
   - Be constructive, not overly critical.

8. Overall paragraph color:
   - "blue" = reference list entry, bibliography, or section that doesn't need verification.
   - "green" = claims are well supported by sources and/or statements are common knowledge.
   - "yellow" = mixed or uncertain support (some partial/uncertain claims, OR sources lack text content).
   - "red" = key claims are definitively unsupported after thorough search, or contradicted by sources.

OUTPUT FORMAT
Return ONLY valid JSON of this exact form (no markdown, no explanation):
{
  "summary": "One short paragraph summarising how many claims are fully supported, partially supported, unsupported, etc.",
  "overall_color": "green | yellow | red | blue",
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
          "excerpt": "<short excerpt from the source's extracted_text>",
          "page_number": 12,
          "section": "Results"
        }
      ],
      "issues_or_suggestions": ["Example: Consider softening wording from 'proves' to 'suggests'."]
    }
  ],
  "missing_or_ambiguous_citations": [
    {
      "text": "<statement from paragraph>",
      "note": "This claim may benefit from a citation."
    }
  ]
}

ROBUSTNESS
- Search through ALL of the extracted_text, not just the beginning.
- If no relevant content is found anywhere in the source after thorough search, say so explicitly.
- Do not rewrite the thesis paragraph; only analyse and diagnose.
- Be fair: if evidence exists, acknowledge it. Only mark red when genuinely unsupported.`;

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
        JSON.stringify({ error: 'AI features are unavailable. Please configure the Google AI API key.' }),
        { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Pre-check: detect if paragraph is a reference entry (skip AI call entirely)
    const isReferenceEntry = (text: string): boolean => {
      const lowerText = text.toLowerCase();
      // DOI pattern
      if (/doi[:\.]?\s*10\.\d+/i.test(text) || /doi\.org\/10\.\d+/i.test(text)) return true;
      // URL-heavy short text
      if (/https?:\/\/[^\s]+/.test(text) && text.length < 500) return true;
      // Standard numbered reference: [1] Author...
      if (/^\[?\d+\]?\s*[A-Z][a-z]+,?\s+[A-Z]\.?/.test(text)) return true;
      // Author-year: Smith, J. (2023)
      if (/^[A-Z][a-z]+,\s*[A-Z]\.?\s*\(\d{4}\)/.test(text)) return true;
      // Multiple journal indicators
      const journalPatterns = ['journal of', 'proceedings', 'vol.', 'pp.', 'isbn', 'issn', 'retrieved from'];
      const matchCount = journalPatterns.filter(p => lowerText.includes(p)).length;
      if (matchCount >= 2) return true;
      return false;
    };

    if (isReferenceEntry(paragraph)) {
      console.log('Paragraph detected as reference entry, skipping AI check');
      return new Response(
        JSON.stringify({ 
          result: {
            summary: "This appears to be a reference/bibliography entry and does not require verification.",
            overall_color: "blue",
            claims: [],
            missing_or_ambiguous_citations: []
          }
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Build the user message with sources context including their full text
    let sourcesContext = '\n\nAVAILABLE SOURCES:\n';
    let sourcesWithText = 0;
    let totalSources = 0;
    
    if (sources && sources.length > 0) {
      totalSources = sources.length;
      for (const s of sources) {
        sourcesContext += `\n--- SOURCE: ${s.in_text_label || s.shorthand_id} ---\n`;
        sourcesContext += `Title: ${s.title || 'Untitled'}\n`;
        sourcesContext += `Authors: ${s.authors || 'Unknown'}\n`;
        sourcesContext += `Year: ${s.year || 'n.d.'}\n`;
        
        if (s.extracted_text && s.extracted_text.length > 100) {
          sourcesWithText++;
          // Include the full extracted text (already truncated on client side if needed)
          sourcesContext += `\nFULL EXTRACTED TEXT (${s.extracted_text.length} characters - search ALL of this for evidence):\n`;
          sourcesContext += `${s.extracted_text}\n`;
          sourcesContext += `--- END OF SOURCE ---\n`;
        } else {
          sourcesContext += `\n[No text content extracted for this source - mark claims citing this as "Uncertain"]\n--- END OF SOURCE ---\n`;
        }
      }
    } else {
      sourcesContext = '\n\nNo sources available for verification.';
    }

    // Add source availability summary
    const sourcesSummary = totalSources > 0 
      ? `\n\nSOURCE AVAILABILITY: ${sourcesWithText}/${totalSources} sources have extracted text content.`
      : '';

    const userMessage = `PARAGRAPH TO ANALYZE:\n"${paragraph}"${sourcesContext}${sourcesSummary}\n\nAnalyze this paragraph by searching through ALL the source texts provided above. Be thorough but fair. Return the JSON result.`;

    console.log(`Checking paragraph with ${sources.length} sources (total chars: ${userMessage.length})`);

    // Retry logic with exponential backoff for rate limits
    const MAX_RETRIES = 3;
    const INITIAL_DELAY = 1000;
    
    let lastError: Error | null = null;
    let response: Response | null = null;
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = INITIAL_DELAY * Math.pow(2, attempt - 1);
        console.log(`Rate limited, waiting ${delay}ms before retry ${attempt + 1}/${MAX_RETRIES}...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      console.log(`Calling Google Gemini API (attempt ${attempt + 1}/${MAX_RETRIES})...`);

      try {
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GOOGLE_AI_API_KEY}`, {
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
              maxOutputTokens: 8192,
            }
          }),
        });

        if (response.ok) {
          break; // Success, exit retry loop
        }

        if (response.status === 429) {
          const errorText = await response.text();
          console.log('Rate limit hit:', errorText);
          lastError = new Error('Rate limit exceeded');
          continue;
        }

        // Non-retryable error
        const errorText = await response.text();
        console.error('AI gateway error:', response.status, errorText);
        
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: 'AI credits exhausted. Please add credits in Settings → Workspace → Usage.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        return new Response(
          JSON.stringify({ error: 'AI service temporarily unavailable' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (fetchError) {
        console.error('Fetch error:', fetchError);
        lastError = fetchError instanceof Error ? fetchError : new Error('Network error');
      }
    }

    // All retries exhausted
    if (!response || !response.ok) {
      console.error('All retries exhausted, returning rate limit error');
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Please wait a few seconds and try again.' }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    console.log('Gemini response received');
    
    // Extract content from Gemini response format
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!content) {
      console.error('No content in response:', JSON.stringify(data));
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
    
    // Build a map of source labels to their extracted text for validation
    const sourceTextMap: Map<string, string> = new Map();
    if (sources && sources.length > 0) {
      for (const s of sources) {
        const label = (s.in_text_label || s.shorthand_id || '').toLowerCase().replace(/\s+/g, ' ').trim();
        const text = (s.extracted_text || '').toLowerCase();
        if (label && text.length > 100) {
          sourceTextMap.set(label, text);
          // Also add without parentheses for flexible matching
          sourceTextMap.set(label.replace(/[()]/g, '').trim(), text);
        }
      }
    }
    
    // Helper function to check if excerpt exists in source text
    const excerptExistsInSource = (excerpt: string, label: string): boolean => {
      if (!excerpt || excerpt.length < 10) return false;
      
      const normalizedLabel = label.toLowerCase().replace(/\s+/g, ' ').trim();
      const labelWithoutParens = normalizedLabel.replace(/[()]/g, '').trim();
      
      // Find the source text
      let sourceText = sourceTextMap.get(normalizedLabel) || sourceTextMap.get(labelWithoutParens);
      
      // Try partial matching on label
      if (!sourceText) {
        for (const [key, text] of sourceTextMap.entries()) {
          if (key.includes(labelWithoutParens) || labelWithoutParens.includes(key)) {
            sourceText = text;
            break;
          }
        }
      }
      
      if (!sourceText) {
        console.log(`[VALIDATION] No source text found for label: ${label}`);
        return false;
      }
      
      // Normalize excerpt for comparison
      const normalizedExcerpt = excerpt.toLowerCase().replace(/\s+/g, ' ').trim();
      
      // Check if excerpt exists in source (with some flexibility for minor differences)
      if (sourceText.includes(normalizedExcerpt)) {
        return true;
      }
      
      // Try with just key phrases (first 50 chars of excerpt)
      const keyPhrase = normalizedExcerpt.substring(0, Math.min(50, normalizedExcerpt.length));
      if (sourceText.includes(keyPhrase)) {
        return true;
      }
      
      // Try word-by-word matching (at least 80% of words must be present in sequence)
      const excerptWords = normalizedExcerpt.split(/\s+/).filter(w => w.length > 3);
      if (excerptWords.length < 5) return false;
      
      let matchedInSequence = 0;
      let maxSequence = 0;
      
      for (const word of excerptWords) {
        if (sourceText.includes(word)) {
          matchedInSequence++;
          maxSequence = Math.max(maxSequence, matchedInSequence);
        } else {
          matchedInSequence = 0;
        }
      }
      
      // Require at least 60% of significant words to match in some sequence
      const matchRatio = maxSequence / excerptWords.length;
      if (matchRatio >= 0.6) {
        return true;
      }
      
      console.log(`[VALIDATION] Excerpt not found in source. Match ratio: ${matchRatio.toFixed(2)}, Excerpt preview: "${normalizedExcerpt.substring(0, 100)}..."`);
      return false;
    };

    // POST-PROCESS: Validate that evidence labels match intended_citations AND excerpts exist in source
    if (result.claims && Array.isArray(result.claims)) {
      for (const claim of result.claims) {
        if (claim.evidence && Array.isArray(claim.evidence) && claim.intended_citations && Array.isArray(claim.intended_citations)) {
          const originalEvidenceCount = claim.evidence.length;
          // Normalize citations for comparison (remove extra spaces, etc.)
          const normalizedCitations = claim.intended_citations.map((c: string) => c.toLowerCase().replace(/\s+/g, ' ').trim());
          
          // Filter evidence to only include labels that match intended_citations AND have valid excerpts
          claim.evidence = claim.evidence.filter((ev: any) => {
            const normalizedLabel = (ev.label || '').toLowerCase().replace(/\s+/g, ' ').trim();
            const labelMatches = normalizedCitations.some((c: string) => 
              c === normalizedLabel || 
              c.includes(normalizedLabel.replace(/[()]/g, '')) ||
              normalizedLabel.includes(c.replace(/[()]/g, ''))
            );
            
            if (!labelMatches) {
              console.log(`[VALIDATION] Discarding evidence from "${ev.label}" - not in intended_citations: ${claim.intended_citations.join(', ')}`);
              return false;
            }
            
            // CRITICAL: Verify the excerpt actually exists in the source text
            if (!excerptExistsInSource(ev.excerpt, ev.label)) {
              console.log(`[VALIDATION] Discarding HALLUCINATED evidence from "${ev.label}" - excerpt not found in source text`);
              return false;
            }
            
            return true;
          });
          
          const discardedCount = originalEvidenceCount - claim.evidence.length;
          if (discardedCount > 0) {
            console.log(`[VALIDATION] Filtered ${discardedCount} invalid evidence entries for claim ${claim.index}`);
            
            // If all evidence was discarded, update the verdict
            if (claim.evidence.length === 0 && originalEvidenceCount > 0) {
              claim.verdict = "No verifiable support found in cited sources";
              console.log(`[VALIDATION] Updated verdict for claim ${claim.index} - all evidence was hallucinated`);
            }
          }
        }
      }
      
      // Re-evaluate overall color if hallucinated evidence was removed
      const hasUnsupportedClaims = result.claims.some((c: any) => 
        c.verdict?.toLowerCase().includes('no') || 
        c.verdict?.toLowerCase().includes('unsupported') ||
        c.verdict?.toLowerCase().includes('not found')
      );
      const hasPartialClaims = result.claims.some((c: any) => 
        c.verdict?.toLowerCase().includes('partial') || 
        c.verdict?.toLowerCase().includes('uncertain')
      );
      
      if (hasUnsupportedClaims && result.overall_color === 'green') {
        result.overall_color = 'yellow';
        console.log('[VALIDATION] Downgraded overall_color from green to yellow due to unsupported claims after hallucination check');
      }
    }

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
