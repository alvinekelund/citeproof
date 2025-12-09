-- Add citation_style column to sources table
ALTER TABLE public.sources 
ADD COLUMN citation_style TEXT DEFAULT 'apa7';

-- Add comment explaining valid values
COMMENT ON COLUMN public.sources.citation_style IS 'Citation style: apa7, mla9, chicago, harvard, ieee, vancouver';