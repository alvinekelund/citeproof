import { supabase } from "@/integrations/supabase/client";
import type { Source, ThesisDocument, ThesisParagraph, ParagraphCheck, CheckResult, CitationStyle } from "./types";

// Sources
export async function getSources(): Promise<Source[]> {
  const { data, error } = await supabase
    .from('sources')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return (data || []).map(s => ({
    ...s,
    citation_style: (s.citation_style || 'apa7') as CitationStyle,
  }));
}

export async function createSource(source: Omit<Source, 'id' | 'created_at' | 'updated_at'>): Promise<Source> {
  const { data, error } = await supabase
    .from('sources')
    .insert(source)
    .select()
    .single();
  
  if (error) throw error;
  return {
    ...data,
    citation_style: (data.citation_style || 'apa7') as CitationStyle,
  };
}

export async function updateSource(id: string, updates: Partial<Source>): Promise<Source> {
  const { data, error } = await supabase
    .from('sources')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  
  if (error) throw error;
  return {
    ...data,
    citation_style: (data.citation_style || 'apa7') as CitationStyle,
  };
}

export async function deleteSource(id: string): Promise<void> {
  const { error } = await supabase
    .from('sources')
    .delete()
    .eq('id', id);
  
  if (error) throw error;
}

// File upload
export async function uploadFile(file: File, folder: string): Promise<string> {
  // Files live under the owner's user id so storage RLS can scope writes per user.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('You must be signed in to upload files');

  const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
  const filePath = `${user.id}/${folder}/${filename}`;
  
  const { error } = await supabase.storage
    .from('thesis-files')
    .upload(filePath, file);
  
  if (error) throw error;
  return filePath;
}

export function getFileUrl(filePath: string): string {
  const { data } = supabase.storage
    .from('thesis-files')
    .getPublicUrl(filePath);
  
  return data.publicUrl;
}

export async function downloadSourceFile(filePath: string): Promise<File | null> {
  const { data, error } = await supabase.storage
    .from('thesis-files')
    .download(filePath);
  
  if (error || !data) {
    console.error('Download error:', error);
    return null;
  }
  
  // Convert blob to File
  const filename = filePath.split('/').pop() || 'file';
  return new File([data], filename, { type: data.type });
}

// Thesis documents
export async function getThesisDocuments(): Promise<ThesisDocument[]> {
  const { data, error } = await supabase
    .from('thesis_documents')
    .select('*')
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  return data || [];
}

export async function createThesisDocument(doc: Omit<ThesisDocument, 'id' | 'created_at'>): Promise<ThesisDocument> {
  const { data, error } = await supabase
    .from('thesis_documents')
    .insert(doc)
    .select()
    .single();
  
  if (error) throw error;
  return data;
}

export async function getThesisParagraph(docId: string, index: number): Promise<ThesisParagraph | null> {
  const { data, error } = await supabase
    .from('thesis_paragraphs')
    .select('*')
    .eq('thesis_document_id', docId)
    .eq('index', index)
    .maybeSingle();
  
  if (error) throw error;
  return data;
}

export async function createThesisParagraphs(paragraphs: Omit<ThesisParagraph, 'id' | 'created_at'>[]): Promise<void> {
  const { error } = await supabase
    .from('thesis_paragraphs')
    .insert(paragraphs);
  
  if (error) throw error;
}

// Paragraph checks (history)
export async function getParagraphChecks(): Promise<ParagraphCheck[]> {
  const { data, error } = await supabase
    .from('paragraph_checks')
    .select(`
      *,
      thesis_paragraphs (index)
    `)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  return (data || []).map((check: any) => ({
    id: check.id,
    thesis_paragraph_id: check.thesis_paragraph_id,
    raw_paragraph_text: check.raw_paragraph_text,
    result_json: check.result_json as unknown as CheckResult,
    overall_color: check.overall_color as 'green' | 'yellow' | 'red',
    created_at: check.created_at,
    thesis_paragraph_index: check.thesis_paragraphs?.index
  }));
}

export async function getParagraphCheck(id: string): Promise<ParagraphCheck | null> {
  const { data, error } = await supabase
    .from('paragraph_checks')
    .select(`
      *,
      thesis_paragraphs (index)
    `)
    .eq('id', id)
    .maybeSingle();
  
  if (error) throw error;
  if (!data) return null;
  
  return {
    id: data.id,
    thesis_paragraph_id: data.thesis_paragraph_id || undefined,
    raw_paragraph_text: data.raw_paragraph_text,
    result_json: data.result_json as unknown as CheckResult,
    overall_color: data.overall_color as 'green' | 'yellow' | 'red',
    created_at: data.created_at,
    thesis_paragraph_index: (data as any).thesis_paragraphs?.index
  };
}

export async function createParagraphCheck(check: {
  thesis_paragraph_id?: string;
  raw_paragraph_text: string;
  result_json: CheckResult;
  overall_color: 'green' | 'yellow' | 'red';
}): Promise<ParagraphCheck> {
  const { data, error } = await supabase
    .from('paragraph_checks')
    .insert({
      thesis_paragraph_id: check.thesis_paragraph_id,
      raw_paragraph_text: check.raw_paragraph_text,
      result_json: check.result_json as any,
      overall_color: check.overall_color,
    })
    .select()
    .single();
  
  if (error) throw error;
  return {
    id: data.id,
    thesis_paragraph_id: data.thesis_paragraph_id || undefined,
    raw_paragraph_text: data.raw_paragraph_text,
    result_json: data.result_json as unknown as CheckResult,
    overall_color: data.overall_color as 'green' | 'yellow' | 'red',
    created_at: data.created_at,
  };
}

// Generate shorthand ID from filename
export function generateShorthandId(filename: string): string {
  const name = filename
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .toUpperCase()
    .split(/\s+/)
    .slice(0, 2)
    .join('_');
  
  const year = new Date().getFullYear();
  return `${name}_${year}`;
}
