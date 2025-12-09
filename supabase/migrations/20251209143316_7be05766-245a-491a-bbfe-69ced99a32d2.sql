-- Create copilot sessions table to store thesis checking sessions
CREATE TABLE public.copilot_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  thesis_name TEXT NOT NULL,
  total_paragraphs INTEGER NOT NULL DEFAULT 0,
  checked_paragraphs INTEGER NOT NULL DEFAULT 0,
  paragraphs_data JSONB NOT NULL DEFAULT '[]'::jsonb
);

-- Enable RLS
ALTER TABLE public.copilot_sessions ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (no auth required for now)
CREATE POLICY "Anyone can view copilot sessions" 
ON public.copilot_sessions 
FOR SELECT 
USING (true);

CREATE POLICY "Anyone can create copilot sessions" 
ON public.copilot_sessions 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update copilot sessions" 
ON public.copilot_sessions 
FOR UPDATE 
USING (true);

CREATE POLICY "Anyone can delete copilot sessions" 
ON public.copilot_sessions 
FOR DELETE 
USING (true);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_copilot_sessions_updated_at
BEFORE UPDATE ON public.copilot_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();