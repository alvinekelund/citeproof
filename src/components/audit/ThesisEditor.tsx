import { useState, useMemo, useCallback } from "react";
import { FileEdit, ChevronLeft, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CheckResult as CheckResultType, Source, Claim } from "@/lib/types";
import { ClaimCard } from "./ClaimCard";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { PdfViewerDialog } from "@/components/sources/PdfViewerDialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

interface ParagraphData {
  index: number;
  text: string;
  checked: boolean;
  result?: CheckResultType;
  sectionType?: 'chapter' | 'section' | 'subsection' | 'paragraph';
  sectionTitle?: string;
  shouldCheck?: boolean;
  skipReason?: string;
}

interface ThesisEditorProps {
  paragraphs: ParagraphData[];
  sources: Source[];
  onBack: () => void;
  onUpdateParagraph: (index: number, newText: string) => void;
}

interface ClaimWithParagraph {
  claim: Claim;
  paragraphIndex: number;
  paragraphText: string;
  color: 'green' | 'yellow' | 'red' | 'blue';
  startOffset: number;
  endOffset: number;
}

export function ThesisEditor({ paragraphs, sources, onBack, onUpdateParagraph }: ThesisEditorProps) {
  const [selectedClaim, setSelectedClaim] = useState<ClaimWithParagraph | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSource, setViewerSource] = useState<Source | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerSearchText, setViewerSearchText] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  // Build the full document text with claim positions
  const { fullText, claimPositions } = useMemo(() => {
    let text = '';
    const positions: ClaimWithParagraph[] = [];
    
    paragraphs.forEach((p, pIndex) => {
      const paragraphStart = text.length;
      
      if (p.checked && p.result) {
        // For manually marked paragraphs with no claims, create a synthetic claim
        const claims = p.result.claims.length > 0 
          ? p.result.claims 
          : [{
              index: 1,
              text: p.text,
              intended_citations: [],
              verdict: p.result.summary,
              common_knowledge: false,
              evidence: [],
              issues_or_suggestions: [],
            }];
        
        claims.forEach((claim) => {
          // Find claim text position in paragraph
          const claimInParagraph = p.text.indexOf(claim.text);
          const startOffset = paragraphStart + (claimInParagraph >= 0 ? claimInParagraph : 0);
          const endOffset = startOffset + claim.text.length;
          
          const color = getClaimColor(claim, p.result!.overall_color);
          
          positions.push({
            claim,
            paragraphIndex: pIndex,
            paragraphText: p.text,
            color,
            startOffset,
            endOffset,
          });
        });
      }
      
      text += p.text + '\n\n';
    });
    
    return { fullText: text, claimPositions: positions };
  }, [paragraphs]);

  const getClaimColor = (claim: Claim, overallColor: string): 'green' | 'yellow' | 'red' | 'blue' => {
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
    
    // Fall back to overall color for manual marks
    return overallColor as 'green' | 'yellow' | 'red' | 'blue';
  };

  // Render text with highlighted claims
  const renderHighlightedText = useCallback(() => {
    if (claimPositions.length === 0) {
      return <span>{fullText}</span>;
    }

    // Sort claims by position
    const sortedClaims = [...claimPositions].sort((a, b) => a.startOffset - b.startOffset);
    
    const elements: React.ReactNode[] = [];
    let lastEnd = 0;

    sortedClaims.forEach((cp, i) => {
      // Add text before this claim
      if (cp.startOffset > lastEnd) {
        elements.push(
          <span key={`text-${i}`}>
            {fullText.substring(lastEnd, cp.startOffset)}
          </span>
        );
      }

      // Add the claim with highlighting
      const colorClasses = {
        green: 'bg-verdict-green/20 hover:bg-verdict-green/30 border-b-2 border-verdict-green cursor-pointer',
        yellow: 'bg-verdict-yellow/20 hover:bg-verdict-yellow/30 border-b-2 border-verdict-yellow cursor-pointer',
        red: 'bg-verdict-red/20 hover:bg-verdict-red/30 border-b-2 border-verdict-red cursor-pointer',
        blue: 'bg-verdict-blue/20 hover:bg-verdict-blue/30 border-b-2 border-verdict-blue cursor-pointer',
      };

      elements.push(
        <span
          key={`claim-${i}`}
          className={cn(
            'transition-colors rounded px-0.5',
            colorClasses[cp.color],
            selectedClaim?.claim.index === cp.claim.index && 
            selectedClaim?.paragraphIndex === cp.paragraphIndex && 
            'ring-2 ring-primary'
          )}
          onClick={() => setSelectedClaim(cp)}
        >
          {fullText.substring(cp.startOffset, cp.endOffset)}
        </span>
      );

      lastEnd = cp.endOffset;
    });

    // Add remaining text
    if (lastEnd < fullText.length) {
      elements.push(
        <span key="text-end">
          {fullText.substring(lastEnd)}
        </span>
      );
    }

    return elements;
  }, [fullText, claimPositions, selectedClaim]);

  const handleOpenSource = (source: Source, pageNumber: number, excerpt?: string) => {
    setViewerSource(source);
    setViewerPage(pageNumber);
    setViewerSearchText(excerpt);
    setViewerOpen(true);
  };

  const handleImplementRewrite = (newText: string) => {
    if (!selectedClaim) return;
    
    const paragraph = paragraphs[selectedClaim.paragraphIndex];
    if (!paragraph) return;
    
    // Replace the claim text in the paragraph
    const newParagraphText = paragraph.text.replace(selectedClaim.claim.text, newText);
    onUpdateParagraph(selectedClaim.paragraphIndex, newParagraphText);
    
    // Update the selected claim with new text
    setSelectedClaim({
      ...selectedClaim,
      claim: { ...selectedClaim.claim, text: newText },
      paragraphText: newParagraphText,
    });
    
    toast({ title: "Rewrite implemented", description: "The text has been updated in the document." });
  };

  const copyFullText = async () => {
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  // Stats
  const stats = useMemo(() => {
    const colors = { green: 0, yellow: 0, red: 0, blue: 0 };
    claimPositions.forEach(cp => colors[cp.color]++);
    return colors;
  }, [claimPositions]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack}>
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to Copilot
          </Button>
          <div className="flex items-center gap-2">
            <FileEdit className="h-5 w-5 text-primary" />
            <span className="font-semibold">Full Thesis Editor</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex gap-2 text-sm">
            {stats.green > 0 && <span className="text-verdict-green">{stats.green} ✓</span>}
            {stats.yellow > 0 && <span className="text-verdict-yellow">{stats.yellow} ⚠</span>}
            {stats.red > 0 && <span className="text-verdict-red">{stats.red} ✗</span>}
            {stats.blue > 0 && <span className="text-verdict-blue">{stats.blue} ○</span>}
          </div>
          <Button variant="outline" size="sm" onClick={copyFullText}>
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? 'Copied!' : 'Copy All'}
          </Button>
        </div>
      </div>

      {/* Main Editor Layout */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: Document Text */}
        <Card className="p-4">
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="prose prose-sm max-w-none whitespace-pre-wrap font-serif leading-relaxed text-foreground">
              {renderHighlightedText()}
            </div>
          </ScrollArea>
        </Card>

        {/* Right: Selected Claim Details */}
        <div className="space-y-4">
          {selectedClaim ? (
            <>
              <Card className="p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-medium">
                    Paragraph {selectedClaim.paragraphIndex + 1}, Claim {selectedClaim.claim.index}
                  </span>
                  <VerdictBadge color={selectedClaim.color} />
                </div>
                <p className="text-sm text-muted-foreground mb-2">
                  {selectedClaim.claim.verdict}
                </p>
              </Card>

              <ClaimCard
                claim={selectedClaim.claim}
                sources={sources}
                onOpenSource={handleOpenSource}
                onImplementRewrite={handleImplementRewrite}
                showImplementButton={true}
              />
            </>
          ) : (
            <Card className="p-12 text-center">
              <FileEdit className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">Click on a highlighted claim to view details and suggestions</p>
            </Card>
          )}
        </div>
      </div>

      {/* PDF Viewer Dialog */}
      <PdfViewerDialog
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        filePath={viewerSource?.file_path || null}
        fileName={viewerSource?.original_filename || "Document"}
        initialPage={viewerPage}
        searchText={viewerSearchText}
      />
    </div>
  );
}
