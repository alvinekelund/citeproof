import { useState } from "react";
import { Eye, AlertTriangle, Lightbulb, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Claim, Source } from "@/lib/types";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getFile } from "@/lib/client-storage";
import { extractTextFromFile } from "@/lib/pdf-parser";

interface ClaimCardProps {
  claim: Claim;
  sources: Source[];
  onOpenSource?: (source: Source, pageNumber: number) => void;
}

function getVerdictColor(verdict: string, commonKnowledge: boolean): 'green' | 'yellow' | 'red' {
  if (commonKnowledge) return 'green';
  
  const v = verdict.toLowerCase();
  if (v.includes('fully supported') || v.includes('well supported') || v.includes('supported by cited')) {
    return 'green';
  }
  if (v.includes('partially') || v.includes('uncertain') || v.includes('some')) {
    return 'yellow';
  }
  if (v.includes('no clear support') || v.includes('unsupported') || v.includes('not found')) {
    return 'red';
  }
  // Default to yellow for ambiguous cases
  return 'yellow';
}

export function ClaimCard({ claim, sources, onOpenSource }: ClaimCardProps) {
  const verdictColor = getVerdictColor(claim.verdict, claim.common_knowledge);
  const [textViewerOpen, setTextViewerOpen] = useState(false);
  const [textContent, setTextContent] = useState<string>('');
  const [textViewerTitle, setTextViewerTitle] = useState('');
  const [searchExcerpt, setSearchExcerpt] = useState('');
  const [isLoadingText, setIsLoadingText] = useState(false);

  const findSourceByLabel = (label: string): Source | undefined => {
    // Normalize the label for matching
    const normalizedLabel = label.toLowerCase().replace(/[^\w\s,]/g, '').trim();
    
    return sources.find(s => {
      // Check exact in_text_label match
      if (s.in_text_label && s.in_text_label.toLowerCase() === label.toLowerCase()) {
        return true;
      }
      
      // Check if label contains part of the in_text_label
      if (s.in_text_label) {
        const normalizedSourceLabel = s.in_text_label.toLowerCase().replace(/[^\w\s,]/g, '').trim();
        if (normalizedSourceLabel.includes(normalizedLabel) || normalizedLabel.includes(normalizedSourceLabel)) {
          return true;
        }
      }
      
      // Check shorthand_id match
      const shorthandLower = s.shorthand_id.toLowerCase();
      if (normalizedLabel.includes(shorthandLower.split('_')[0])) {
        return true;
      }
      
      // Check authors match
      if (s.authors) {
        const authorParts = s.authors.toLowerCase().split(/[,&\s]+/);
        for (const part of authorParts) {
          if (part.length > 3 && normalizedLabel.includes(part)) {
            return true;
          }
        }
      }
      
      // Check title match
      if (s.title) {
        const titleParts = s.title.toLowerCase().split(/\s+/);
        for (const part of titleParts) {
          if (part.length > 4 && normalizedLabel.includes(part)) {
            return true;
          }
        }
      }
      
      return false;
    });
  };

  const handleOpenSource = async (label: string, pageNumber: number, excerpt?: string) => {
    const source = findSourceByLabel(label);
    if (!source) {
      if (sources.length > 0 && onOpenSource) {
        onOpenSource(sources[0], pageNumber);
      }
      return;
    }

    // Check if it's a PDF or text file
    const isPdf = source.file_path.toLowerCase().endsWith('.pdf');
    
    if (isPdf && onOpenSource) {
      onOpenSource(source, pageNumber);
    } else {
      // Open text viewer for non-PDF files
      setIsLoadingText(true);
      setTextViewerTitle(source.original_filename);
      setSearchExcerpt(excerpt || '');
      setTextViewerOpen(true);
      
      try {
        const file = await getFile(source.file_path);
        if (file) {
          const text = await extractTextFromFile(file);
          setTextContent(text);
        } else {
          setTextContent('File not found. It may have been deleted.');
        }
      } catch (error) {
        setTextContent('Error loading file content.');
      } finally {
        setIsLoadingText(false);
      }
    }
  };

  // Highlight excerpt in text content and return sections
  const getHighlightedSections = (): { before: string; highlight: string; after: string } | null => {
    if (!searchExcerpt || !textContent) return null;
    
    // Find the excerpt in the text (case-insensitive, partial match)
    const searchWords = searchExcerpt.toLowerCase().split(/\s+/).filter(w => w.length > 4).slice(0, 5);
    let bestMatch = { start: -1, end: -1 };
    
    for (let i = 0; i < textContent.length - 50; i++) {
      const snippet = textContent.substring(i, i + searchExcerpt.length + 100).toLowerCase();
      let matchCount = 0;
      for (const word of searchWords) {
        if (snippet.includes(word)) matchCount++;
      }
      if (matchCount >= searchWords.length * 0.6 && bestMatch.start === -1) {
        bestMatch = { start: Math.max(0, i - 200), end: Math.min(textContent.length, i + searchExcerpt.length + 200) };
        break;
      }
    }
    
    if (bestMatch.start === -1) return null;
    
    return {
      before: textContent.substring(0, bestMatch.start),
      highlight: textContent.substring(bestMatch.start, bestMatch.end),
      after: textContent.substring(bestMatch.end),
    };
  };

  const highlightedSections = getHighlightedSections();

  return (
    <>
      <div className={cn(
        "claim-card animate-slide-up",
        verdictColor === 'green' && "claim-card-green",
        verdictColor === 'yellow' && "claim-card-yellow",
        verdictColor === 'red' && "claim-card-red"
      )}>
        <div className="flex items-start justify-between gap-4 mb-3">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-muted-foreground">Claim {claim.index}</span>
              {claim.common_knowledge && (
                <span className="text-xs px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                  Common knowledge
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed">{claim.text}</p>
          </div>
          <VerdictBadge color={verdictColor} />
        </div>

        {claim.intended_citations && claim.intended_citations.length > 0 && (
          <div className="mb-3">
            <span className="text-xs font-medium text-muted-foreground">Citations: </span>
            <span className="text-xs font-mono">{claim.intended_citations.join(', ')}</span>
          </div>
        )}

        <p className="text-sm text-muted-foreground mb-3">{claim.verdict}</p>

        {/* Evidence */}
        {claim.evidence && claim.evidence.length > 0 && (
          <div className="space-y-2 mb-3">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">Evidence</h4>
            {claim.evidence.map((ev, i) => (
              <div key={i} className="bg-secondary/50 rounded-lg p-3 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-primary">{ev.label}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenSource(ev.label, ev.page_number, ev.excerpt)}
                    className="h-7 text-xs gap-1"
                  >
                    <Eye className="h-3 w-3" />
                    {ev.page_number > 0 ? `Page ${ev.page_number}` : 'View'}
                  </Button>
                </div>
                <blockquote className="text-muted-foreground italic border-l-2 border-primary/30 pl-3">
                  "{ev.excerpt}"
                </blockquote>
                {ev.section && (
                  <span className="text-xs text-muted-foreground mt-1 block">
                    Section: {ev.section}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Issues and Suggestions */}
        {claim.issues_or_suggestions && claim.issues_or_suggestions.length > 0 && (
          <div className="space-y-1">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1">
              <Lightbulb className="h-3 w-3" />
              Suggestions
            </h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              {claim.issues_or_suggestions.map((issue, i) => (
                <li key={i} className="flex items-start gap-2">
                  <AlertTriangle className="h-3 w-3 mt-1 flex-shrink-0 text-verdict-yellow" />
                  {issue}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Text Viewer Dialog */}
      <Dialog open={textViewerOpen} onOpenChange={setTextViewerOpen}>
        <DialogContent className="max-w-4xl w-[90vw] h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {textViewerTitle}
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 border rounded-lg p-4 bg-secondary/20">
            {isLoadingText ? (
              <div className="text-center py-8 text-muted-foreground">Loading...</div>
            ) : highlightedSections ? (
              <div className="whitespace-pre-wrap text-sm font-mono">
                <span className="text-muted-foreground">{highlightedSections.before}</span>
                <mark className="bg-verdict-yellow/30 px-1 rounded">{highlightedSections.highlight}</mark>
                <span className="text-muted-foreground">{highlightedSections.after}</span>
              </div>
            ) : (
              <div className="whitespace-pre-wrap text-sm font-mono">{textContent}</div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}