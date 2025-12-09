import { ExternalLink, AlertTriangle, Lightbulb } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Claim, Source } from "@/lib/types";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { cn } from "@/lib/utils";
import { getFileUrl } from "@/lib/supabase-helpers";

interface ClaimCardProps {
  claim: Claim;
  sources: Source[];
}

function getVerdictColor(verdict: string): 'green' | 'yellow' | 'red' {
  const v = verdict.toLowerCase();
  if (v.includes('fully supported') || v.includes('common knowledge')) return 'green';
  if (v.includes('partially') || v.includes('uncertain')) return 'yellow';
  return 'red';
}

export function ClaimCard({ claim, sources }: ClaimCardProps) {
  const verdictColor = claim.common_knowledge ? 'green' : getVerdictColor(claim.verdict);

  const findSourceByLabel = (label: string) => {
    return sources.find(s => 
      s.in_text_label === label || 
      s.shorthand_id.toLowerCase().includes(label.toLowerCase().replace(/[^a-z]/g, ''))
    );
  };

  const openSourceAtPage = (label: string, pageNumber: number) => {
    const source = findSourceByLabel(label);
    if (source) {
      const url = getFileUrl(source.file_path);
      // Add page parameter for PDF viewers that support it
      window.open(`${url}#page=${pageNumber}`, '_blank');
    }
  };

  return (
    <div className={cn(
      "claim-card animate-slide-up",
      `claim-card-${verdictColor}`
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
                  variant="ghost"
                  size="sm"
                  onClick={() => openSourceAtPage(ev.label, ev.page_number)}
                  className="h-6 text-xs"
                >
                  <ExternalLink className="h-3 w-3 mr-1" />
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
