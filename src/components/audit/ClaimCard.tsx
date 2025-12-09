import { ExternalLink, AlertTriangle, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Claim, Source } from "@/lib/types";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { cn } from "@/lib/utils";
import { getFileUrl } from "@/lib/supabase-helpers";
import { toast } from "@/hooks/use-toast";

interface ClaimCardProps {
  claim: Claim;
  sources: Source[];
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

export function ClaimCard({ claim, sources }: ClaimCardProps) {
  const verdictColor = getVerdictColor(claim.verdict, claim.common_knowledge);

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

  const openSourceAtPage = (label: string, pageNumber: number) => {
    const source = findSourceByLabel(label);
    if (source) {
      const url = getFileUrl(source.file_path);
      // Open PDF with page parameter
      window.open(`${url}#page=${pageNumber}`, '_blank');
    } else {
      // Try to open first available source as fallback
      if (sources.length > 0) {
        const url = getFileUrl(sources[0].file_path);
        window.open(`${url}#page=${pageNumber}`, '_blank');
        toast({
          title: "Source not matched",
          description: `Opened first available source. Consider updating the in-text label for "${label}".`,
        });
      } else {
        toast({
          title: "No source found",
          description: `Could not find source matching "${label}". Add it to your source library first.`,
          variant: "destructive",
        });
      }
    }
  };

  return (
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

      {claim.intended_citations.length > 0 && (
        <div className="mb-3">
          <span className="text-xs font-medium text-muted-foreground">Citations: </span>
          <span className="text-xs font-mono">{claim.intended_citations.join(', ')}</span>
        </div>
      )}

      <p className="text-sm text-muted-foreground mb-3">{claim.verdict}</p>

      {/* Evidence */}
      {claim.evidence.length > 0 && (
        <div className="space-y-2 mb-3">
          <h4 className="text-xs font-semibold text-foreground uppercase tracking-wide">Evidence</h4>
          {claim.evidence.map((ev, i) => (
            <div key={i} className="bg-secondary/50 rounded-lg p-3 text-sm">
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs text-primary">{ev.label}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openSourceAtPage(ev.label, ev.page_number)}
                  className="h-7 text-xs gap-1"
                >
                  <ExternalLink className="h-3 w-3" />
                  Page {ev.page_number}
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
      {claim.issues_or_suggestions.length > 0 && (
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
  );
}
