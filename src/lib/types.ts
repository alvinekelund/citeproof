export interface Source {
  id: string;
  in_text_label: string;
  shorthand_id: string;
  filename: string;
  original_filename: string;
  file_path: string;
  url?: string;
  title?: string;
  authors?: string;
  year?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ThesisDocument {
  id: string;
  filename: string;
  file_path: string;
  title?: string;
  total_paragraphs: number;
  created_at: string;
}

export interface ThesisParagraph {
  id: string;
  thesis_document_id: string;
  index: number;
  text: string;
  created_at: string;
}

export interface Evidence {
  label: string;
  excerpt: string;
  page_number: number;
  section?: string;
  source_id?: string;
}

export interface Claim {
  index: number;
  text: string;
  intended_citations: string[];
  verdict: string;
  common_knowledge: boolean;
  evidence: Evidence[];
  issues_or_suggestions: string[];
}

export interface MissingCitation {
  text: string;
  note: string;
}

export interface CheckResult {
  summary: string;
  overall_color: 'green' | 'yellow' | 'red';
  claims: Claim[];
  missing_or_ambiguous_citations: MissingCitation[];
}

export interface ParagraphCheck {
  id: string;
  thesis_paragraph_id?: string;
  raw_paragraph_text: string;
  result_json: CheckResult;
  overall_color: 'green' | 'yellow' | 'red';
  created_at: string;
  thesis_paragraph_index?: number;
}
