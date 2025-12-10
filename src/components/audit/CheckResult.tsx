import { useState } from "react";
import { CheckResult as CheckResultType, Source, Claim } from "@/lib/types";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { ClaimCard } from "./ClaimCard";
import { AlertTriangle } from "lucide-react";
import { PdfViewerDialog } from "@/components/sources/PdfViewerDialog";

interface CheckResultProps {
  result: CheckResultType;
  paragraphText: string;
  sources: Source[];
}

// Determine highlight color based on claim verdict
function getClaimHighlightColor(claim: Claim): 'green' | 'yellow' | 'red' | 'blue' {
  if (claim.common_knowledge) return 'green';
  
  const v = claim.verdict.toLowerCase();
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

export function CheckResult({ result, paragraphText, sources }: CheckResultProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSource, setViewerSource] = useState<Source | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerSearchText, setViewerSearchText] = useState<string | undefined>(undefined);
  const [viewerHighlightColor, setViewerHighlightColor] = useState<'green' | 'yellow' | 'red' | 'blue' | undefined>(undefined);
  const [currentClaimIndex, setCurrentClaimIndex] = useState<number | null>(null);

  const handleOpenSource = (source: Source, pageNumber: number, excerpt?: string, claimIndex?: number) => {
    setViewerSource(source);
    setViewerPage(pageNumber);
    setViewerSearchText(excerpt);
    // Set highlight color based on the claim that triggered this
    if (claimIndex !== undefined && result.claims[claimIndex]) {
      setViewerHighlightColor(getClaimHighlightColor(result.claims[claimIndex]));
    } else {
      setViewerHighlightColor(undefined);
    }
    setCurrentClaimIndex(claimIndex ?? null);
    setViewerOpen(true);
  };

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

      {/* Note: paragraph text is already shown above in CopilotMode, no need to duplicate */}

      {/* Claims breakdown */}
      <div className="space-y-4">
        <h3 className="font-semibold">Claims Analysis ({result.claims.length})</h3>
        {result.claims.map((claim, idx) => (
          <ClaimCard 
            key={claim.index} 
            claim={claim} 
            sources={sources} 
            onOpenSource={(source, pageNumber, excerpt) => handleOpenSource(source, pageNumber, excerpt, idx)}
            highlightColor={getClaimHighlightColor(claim)}
          />
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
                <p className="font-medium">"{typeof item.text === 'string' ? item.text : JSON.stringify(item.text)}"</p>
                <p className="text-muted-foreground mt-1">
                  {typeof item.note === 'string' ? item.note : (item.note && typeof item.note === 'object' && 'note' in item.note) ? (item.note as any).note : JSON.stringify(item.note)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* PDF Viewer Dialog */}
      <PdfViewerDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        filePath={viewerSource?.file_path || null}
        fileName={viewerSource?.original_filename || "Document"}
        initialPage={viewerPage}
        searchText={viewerSearchText}
        highlightColor={viewerHighlightColor}
      />
    </div>
  );
}
