import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface Citation {
  raw: string;
  normalized: string;
  count: number;
  matched: boolean;
  matchedSourceId?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { citations } = await req.json();
    
    if (!citations || !Array.isArray(citations) || citations.length === 0) {
      return new Response(JSON.stringify({ citations: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Only process unmatched citations for deduplication
    const unmatchedCitations = citations.filter((c: Citation) => !c.matched);
    const matchedCitations = citations.filter((c: Citation) => c.matched);

    if (unmatchedCitations.length === 0) {
      return new Response(JSON.stringify({ citations }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY");
    if (!GOOGLE_AI_API_KEY) {
      console.error("GOOGLE_AI_API_KEY not configured");
      return new Response(JSON.stringify({ citations }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Build prompt for AI
    const citationList = unmatchedCitations.map((c: Citation, i: number) => 
      `${i + 1}. "${c.raw}" (normalized: "${c.normalized}", count: ${c.count})`
    ).join('\n');

    const systemPrompt = `You are an academic citation expert. Your task is to identify duplicate citations that refer to the SAME source but are written differently.

Rules:
- Two citations are duplicates if they refer to the same author(s) and year
- "Author et al., 2023" and "Author, 2023" for the same first author ARE duplicates
- "(Author, 2023)" and "Author (2023)" ARE duplicates (same source, different format)
- "Author & Coauthor, 2023" and "Author et al., 2023" might be duplicates if Author is the first author
- Different years = NOT duplicates
- Different first authors = NOT duplicates

Return a JSON object with:
- "groups": array of arrays, where each inner array contains the indices (1-based) of citations that are duplicates of each other
- "canonical": for each group, the index of the most complete/correct citation form to keep

Example:
Input: 
1. "(Dell'Acqua et al., 2023)"
2. "Dell'Acqua et al. (2023)"
3. "(Noy & Zhang, 2023)"

Output:
{"groups": [[1, 2]], "canonical": [1]}

This means citations 1 and 2 are duplicates, and we keep citation 1 as the canonical form.
Citations not in any group are unique.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GOOGLE_AI_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt + `\n\nIdentify duplicate citations:\n\n${citationList}` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              groups: {
                type: "array",
                items: {
                  type: "array",
                  items: { type: "number" }
                },
                description: "Arrays of 1-based indices that are duplicates of each other"
              },
              canonical: {
                type: "array",
                items: { type: "number" },
                description: "For each group, the 1-based index of the preferred citation form"
              }
            },
            required: ["groups", "canonical"]
          }
        }
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Gemini API error:", response.status, errText);
      return new Response(JSON.stringify({ citations }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();

    let result: { groups: number[][], canonical: number[] } = { groups: [], canonical: [] };

    const jsonText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (jsonText) {
      try {
        result = JSON.parse(jsonText);
      } catch (e) {
        console.error("Failed to parse Gemini JSON response:", e);
      }
    }

    // Build set of indices to remove (keep only canonical from each group)
    const indicesToRemove = new Set<number>();
    for (let i = 0; i < result.groups.length; i++) {
      const group = result.groups[i];
      const canonicalIdx = result.canonical[i];
      
      // Sum counts into canonical citation
      let totalCount = 0;
      for (const idx of group) {
        if (idx !== canonicalIdx && idx >= 1 && idx <= unmatchedCitations.length) {
          indicesToRemove.add(idx - 1); // Convert to 0-based
          totalCount += unmatchedCitations[idx - 1].count;
        }
      }
      
      // Add counts to canonical
      if (canonicalIdx >= 1 && canonicalIdx <= unmatchedCitations.length) {
        unmatchedCitations[canonicalIdx - 1].count += totalCount;
      }
    }

    // Filter out duplicates
    const dedupedUnmatched = unmatchedCitations.filter((_: Citation, i: number) => !indicesToRemove.has(i));
    
    // Combine back with matched citations
    const dedupedCitations = [...matchedCitations, ...dedupedUnmatched];

    console.log(`Deduplication: ${unmatchedCitations.length} -> ${dedupedUnmatched.length} unmatched citations`);

    return new Response(JSON.stringify({ 
      citations: dedupedCitations,
      deduped: indicesToRemove.size 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error("Error in dedupe-citations:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
