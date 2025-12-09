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
    const { filename, shorthand_id } = await req.json();

    if (!filename) {
      return new Response(
        JSON.stringify({ error: 'No filename provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      // Gracefully fail - return a basic suggestion
      return new Response(
        JSON.stringify({ 
          suggested_label: '',
          error: 'AI features unavailable'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const prompt = `Based on this academic PDF filename, suggest an in-text citation label in APA format like "(Author et al., 2023)" or "(Author & Author, 2023)".

Filename: "${filename}"

Extract the likely author surname(s) and year from the filename. If unclear, make a reasonable guess.

Return ONLY the citation label, nothing else. Example outputs:
- (Smith et al., 2023)
- (Johnson & Williams, 2022)
- (Brown, 2021)`;

    console.log('Suggesting label for:', filename);

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
      return new Response(
        JSON.stringify({ suggested_label: '' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const suggested_label = data.choices?.[0]?.message?.content?.trim() || '';

    console.log('Suggested label:', suggested_label);

    return new Response(
      JSON.stringify({ suggested_label }),
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
