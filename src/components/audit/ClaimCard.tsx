import { useState } from "react";
import { Eye, AlertTriangle, Lightbulb, FileText, Wand2, Loader2, BookOpen, PenLine, Copy, Check } from "lucide-react";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface ClaimCardProps {
  claim: Claim;
  sources: Source[];
  onOpenSource?: (source: Source, pageNumber: number, excerpt?: string) => void;
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
  return 'yellow';
}

export function ClaimCard({ claim, sources, onOpenSource }: ClaimCardProps) {
  const verdictColor = getVerdictColor(claim.verdict, claim.common_knowledge);
  const [textViewerOpen, setTextViewerOpen] = useState(false);
  const [textContent, setTextContent] = useState<string>('');
  const [textViewerTitle, setTextViewerTitle] = useState('');
  const [searchExcerpt, setSearchExcerpt] = useState('');
  const [isLoadingText, setIsLoadingText] = useState(false);
  
  // Rewrite state
  const [isRewriting, setIsRewriting] = useState(false);
  const [rewriteResult, setRewriteResult] = useState<{
    rewritten_claim: string;
    suggested_source?: string;
    strategy?: string;
    explanation: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const findSourceByLabel = (label: string): Source | undefined => {
    // Extract author name(s) and year from label like "(Noy & Zhang, 2023)" or "Noy and Zhang (2023)"
    const yearMatch = label.match(/\b(19|20)\d{2}[a-z]?\b/);
    const year = yearMatch ? parseInt(yearMatch[0].replace(/[a-z]/g, '')) : null;
    
    // Extract author names - remove year and clean up
    const authorPart = label
      .replace(/\([^)]*\d{4}[^)]*\)/g, '') // Remove parenthetical year
      .replace(/\b(19|20)\d{2}[a-z]?\b/g, '') // Remove standalone years
      .replace(/[()]/g, '')
      .replace(/\bet\s+al\.?\b/gi, '')
      .replace(/[,&]/g, ' ')
      .trim()
      .toLowerCase();
    
    const authorNames = authorPart.split(/\s+/).filter(n => n.length > 2);
    
    // Score each source based on match quality
    let bestMatch: { source: Source; score: number } | null = null;
    
    for (const source of sources) {
      let score = 0;
      
      // Year match is critical - must match if both have years
      if (year && source.year) {
        if (source.year === year) {
          score += 50; // Strong boost for year match
        } else {
          continue; // Year mismatch - skip this source
        }
      }
      
      // Check in_text_label exact match (highest priority)
      if (source.in_text_label) {
        const sourceLabel = source.in_text_label.toLowerCase();
        if (sourceLabel === label.toLowerCase() || 
            sourceLabel.replace(/[()]/g, '') === label.toLowerCase().replace(/[()]/g, '')) {
          score += 100;
        }
      }
      
      // Check author name matches
      if (source.authors && authorNames.length > 0) {
        const sourceAuthors = source.authors.toLowerCase();
        let authorsMatched = 0;
        
        for (const name of authorNames) {
          if (name.length > 2 && sourceAuthors.includes(name)) {
            authorsMatched++;
          }
        }
        
        // Require at least one author name match
        if (authorsMatched > 0) {
          score += authorsMatched * 20;
        }
      }
      
      // Check in_text_label contains author names  
      if (source.in_text_label && authorNames.length > 0) {
        const sourceLabel = source.in_text_label.toLowerCase();
        for (const name of authorNames) {
          if (name.length > 2 && sourceLabel.includes(name)) {
            score += 15;
          }
        }
      }
      
      // Update best match
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { source, score };
      }
    }
    
    // Only return if we have a reasonable match (year + at least one author)
    if (bestMatch && bestMatch.score >= 50) {
      return bestMatch.source;
    }
    
    return undefined;
  };

  const handleOpenSource = async (label: string, pageNumber: number, excerpt?: string) => {
    const source = findSourceByLabel(label);
    if (!source) {
      toast({
        title: "Source not found",
        description: `Could not find source matching "${label}" in the library`,
        variant: "destructive",
      });
      return;
    }

    const isPdf = source.file_path.toLowerCase().endsWith('.pdf');
    
    if (isPdf && onOpenSource) {
      onOpenSource(source, pageNumber, excerpt);
    } else {
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

  const handleRewrite = async (mode: 'find_source' | 'make_defensible') => {
    setIsRewriting(true);
    setRewriteResult(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('rewrite-claim', {
        body: {
          claim: claim.text,
          sources: sources.map(s => ({
            id: s.id,
            in_text_label: s.in_text_label,
            shorthand_id: s.shorthand_id,
            title: s.title,
            authors: s.authors,
            year: s.year,
          })),
          mode,
        },
      });

      if (error) throw error;
      if (data.error) throw new Error(data.error);
      
      setRewriteResult(data.result);
      toast({ title: "Rewrite generated", description: "Click to copy the suggestion" });
    } catch (error: unknown) {
      console.error('Rewrite error:', error);
      const msg = error instanceof Error ? error.message : 'Unknown error';
      if (msg.includes('429')) {
        toast({ title: "Rate limited", description: "Please wait and try again", variant: "destructive" });
      } else if (msg.includes('402')) {
        toast({ title: "AI credits exhausted", description: "Add credits to continue", variant: "destructive" });
      } else {
        toast({ title: "Rewrite failed", description: msg, variant: "destructive" });
      }
    } finally {
      setIsRewriting(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const getHighlightedSections = (): { before: string; highlight: string; after: string } | null => {
    if (!searchExcerpt || !textContent) return null;
    
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
  const showRewriteButtons = verdictColor === 'red' || verdictColor === 'yellow';

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
          <div className="space-y-1 mb-3">
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

        {/* AI Rewrite Section */}
        {showRewriteButtons && (
          <div className="border-t pt-3 mt-3">
            <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide flex items-center gap-1 mb-2">
              <Wand2 className="h-3 w-3" />
              AI Rewrite Options
            </h4>
            <div className="flex gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRewrite('find_source')}
                disabled={isRewriting || sources.length === 0}
                className="text-xs"
              >
                {isRewriting ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <BookOpen className="h-3 w-3 mr-1" />
                )}
                Find Source & Cite
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRewrite('make_defensible')}
                disabled={isRewriting}
                className="text-xs"
              >
                {isRewriting ? (
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                ) : (
                  <PenLine className="h-3 w-3 mr-1" />
                )}
                Make Defensible
              </Button>
            </div>

            {/* Rewrite Result */}
            {rewriteResult && (
              <div className="mt-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="text-xs font-medium text-primary">Suggested Rewrite:</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(rewriteResult.rewritten_claim)}
                    className="h-6 text-xs"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 mr-1" />
                    ) : (
                      <Copy className="h-3 w-3 mr-1" />
                    )}
                    {copied ? 'Copied!' : 'Copy'}
                  </Button>
                </div>
                <p className="text-sm leading-relaxed mb-2">{rewriteResult.rewritten_claim}</p>
                {rewriteResult.suggested_source && (
                  <p className="text-xs text-muted-foreground">
                    <strong>Source:</strong> {rewriteResult.suggested_source}
                  </p>
                )}
                {rewriteResult.strategy && (
                  <p className="text-xs text-muted-foreground">
                    <strong>Strategy:</strong> {rewriteResult.strategy}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  <strong>Explanation:</strong> {rewriteResult.explanation}
                </p>
              </div>
            )}
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
