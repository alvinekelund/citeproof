import { CheckResult as CheckResultType, Source } from "@/lib/types";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { ClaimCard } from "./ClaimCard";
import { AlertTriangle } from "lucide-react";

interface CheckResultProps {
  result: CheckResultType;
  paragraphText: string;
  sources: Source[];
}

export function CheckResult({ result, paragraphText, sources }: CheckResultProps) {
  return (
    <div className="space-y-6 animate-fade-in">
      {/* Overall verdict */}
      <div className={`p-4 rounded-lg border-2 ${
        result.overall_color === 'green' ? 'border-verdict-green bg-verdict-green-bg' :
        result.overall_color === 'yellow' ? 'border-verdict-yellow bg-verdict-yellow-bg' :
        'border-verdict-red bg-verdict-red-bg'
      }`}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-lg">Analysis Complete</h3>
          <VerdictBadge color={result.overall_color} size="lg" />
        </div>
        <p className="text-sm">{result.summary}</p>
      </div>

      {/* Original paragraph */}
      <div className="bg-card border rounded-lg p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Analyzed Paragraph
        </h4>
        <p className="text-sm leading-relaxed">{paragraphText}</p>
      </div>

      {/* Claims breakdown */}
      <div className="space-y-4">
        <h3 className="font-semibold">Claims Analysis ({result.claims.length})</h3>
        {result.claims.map((claim) => (
          <ClaimCard key={claim.index} claim={claim} sources={sources} />
        ))}
      </div>

      {/* Missing citations */}
      {result.missing_or_ambiguous_citations.length > 0 && (
        <div className="bg-verdict-yellow-bg border border-verdict-yellow/20 rounded-lg p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-verdict-yellow" />
            Missing or Ambiguous Citations
          </h3>
          <ul className="space-y-3">
            {result.missing_or_ambiguous_citations.map((item, i) => (
              <li key={i} className="text-sm">
                <p className="font-medium">"{item.text}"</p>
                <p className="text-muted-foreground mt-1">{item.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
