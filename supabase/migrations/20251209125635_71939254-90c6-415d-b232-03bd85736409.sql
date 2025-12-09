-- Create sources table for storing uploaded PDFs and their metadata
CREATE TABLE public.sources (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  in_text_label TEXT DEFAULT '',
  shorthand_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  url TEXT,
  title TEXT,
  authors TEXT,
  year INTEGER,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create thesis_documents table
CREATE TABLE public.thesis_documents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  filename TEXT NOT NULL,
  file_path TEXT NOT NULL,
  title TEXT,
  total_paragraphs INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create thesis_paragraphs table
CREATE TABLE public.thesis_paragraphs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thesis_document_id UUID NOT NULL REFERENCES public.thesis_documents(id) ON DELETE CASCADE,
  index INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for efficient paragraph lookup
CREATE INDEX idx_thesis_paragraphs_document_index ON public.thesis_paragraphs(thesis_document_id, index);

-- Create paragraph_checks table for history
CREATE TABLE public.paragraph_checks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  thesis_paragraph_id UUID REFERENCES public.thesis_paragraphs(id) ON DELETE SET NULL,
  raw_paragraph_text TEXT NOT NULL,
  result_json JSONB,
  overall_color TEXT NOT NULL CHECK (overall_color IN ('green', 'yellow', 'red')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for history queries
CREATE INDEX idx_paragraph_checks_created_at ON public.paragraph_checks(created_at DESC);

-- Enable RLS on all tables (but allow public access since this is a single-user academic tool)
ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thesis_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.thesis_paragraphs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paragraph_checks ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (single-user tool, no auth required)
CREATE POLICY "Allow all operations on sources" ON public.sources FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on thesis_documents" ON public.thesis_documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on thesis_paragraphs" ON public.thesis_paragraphs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all operations on paragraph_checks" ON public.paragraph_checks FOR ALL USING (true) WITH CHECK (true);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger for sources
CREATE TRIGGER update_sources_updated_at
  BEFORE UPDATE ON public.sources
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for uploaded files
INSERT INTO storage.buckets (id, name, public) VALUES ('thesis-files', 'thesis-files', true);

-- Create storage policies for public access
CREATE POLICY "Allow public read access to thesis-files" ON storage.objects FOR SELECT USING (bucket_id = 'thesis-files');
CREATE POLICY "Allow public upload to thesis-files" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'thesis-files');
CREATE POLICY "Allow public update to thesis-files" ON storage.objects FOR UPDATE USING (bucket_id = 'thesis-files');
CREATE POLICY "Allow public delete from thesis-files" ON storage.objects FOR DELETE USING (bucket_id = 'thesis-files');