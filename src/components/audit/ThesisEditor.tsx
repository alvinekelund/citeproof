import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Copy, Check, AlertTriangle, CheckCircle, Undo2, FileText, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CheckResult as CheckResultType, Source, Claim } from "@/lib/types";
import { ClaimCard } from "./ClaimCard";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { PdfViewerDialog } from "@/components/sources/PdfViewerDialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

interface FlatClaim {
  claim: Claim;
  paragraphIndex: number;
  claimIndex: number;
  paragraphText: string;
  color: 'green' | 'yellow' | 'red' | 'blue';
  overallColor: string;
}

// Track original state before rewrite
interface RewriteHistoryEntry {
  originalClaimText: string;
  originalParagraphText: string;
}

export function ThesisEditor({ paragraphs, sources, onBack, onUpdateParagraph }: ThesisEditorProps) {
  const [selectedClaimIndex, setSelectedClaimIndex] = useState(0);
  const [rewriteHistory, setRewriteHistory] = useState<Map<string, RewriteHistoryEntry>>(new Map());
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSource, setViewerSource] = useState<Source | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerSearchText, setViewerSearchText] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'claims' | 'document'>('claims');

  const getClaimColor = useCallback((claim: Claim, overallColor: string): 'green' | 'yellow' | 'red' | 'blue' => {
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
    
    return overallColor as 'green' | 'yellow' | 'red' | 'blue';
  }, []);

  // Flatten all claims from all checked paragraphs into a single list
  const allClaims: FlatClaim[] = useMemo(() => {
    const claims: FlatClaim[] = [];
    
    paragraphs.forEach((p) => {
      if (p.checked && p.result?.claims) {
        p.result.claims.forEach((claim, claimIdx) => {
          claims.push({
            claim,
            paragraphIndex: p.index,
            claimIndex: claimIdx,
            paragraphText: p.text,
            color: getClaimColor(claim, p.result!.overall_color),
            overallColor: p.result!.overall_color,
          });
        });
      }
    });
    
    return claims;
  }, [paragraphs, getClaimColor]);

  const currentClaim = allClaims[selectedClaimIndex];
  
  // Check if current claim has been modified
  const currentClaimKey = currentClaim ? `${currentClaim.paragraphIndex}-${currentClaim.claimIndex}` : null;
  const currentClaimHistory = currentClaimKey ? rewriteHistory.get(currentClaimKey) : null;
  
  // Count claims by color
  const claimCounts = useMemo(() => {
    const counts = { green: 0, yellow: 0, red: 0, blue: 0, total: allClaims.length };
    allClaims.forEach(c => {
      counts[c.color]++;
    });
    return counts;
  }, [allClaims]);

  // Navigation
  const goToPrevClaim = useCallback(() => {
    setSelectedClaimIndex(prev => Math.max(0, prev - 1));
  }, []);

  const goToNextClaim = useCallback(() => {
    setSelectedClaimIndex(prev => Math.min(allClaims.length - 1, prev + 1));
  }, [allClaims.length]);

  const goToNextProblem = useCallback(() => {
    // Find next red or yellow claim after current
    for (let i = selectedClaimIndex + 1; i < allClaims.length; i++) {
      if (allClaims[i].color === 'red' || allClaims[i].color === 'yellow') {
        setSelectedClaimIndex(i);
        return;
      }
    }
    // Wrap around
    for (let i = 0; i < selectedClaimIndex; i++) {
      if (allClaims[i].color === 'red' || allClaims[i].color === 'yellow') {
        setSelectedClaimIndex(i);
        return;
      }
    }
    toast({ title: "No more issues", description: "All claims are verified." });
  }, [selectedClaimIndex, allClaims]);

  // Handle implementing a rewrite
  const handleImplementRewrite = useCallback((newClaimText: string) => {
    if (!currentClaim) return;
    
    const key = `${currentClaim.paragraphIndex}-${currentClaim.claimIndex}`;
    
    // Store the original text before rewriting (only if not already stored)
    if (!rewriteHistory.has(key)) {
      setRewriteHistory(prev => {
        const newMap = new Map(prev);
        newMap.set(key, {
          originalClaimText: currentClaim.claim.text,
          originalParagraphText: currentClaim.paragraphText,
        });
        return newMap;
      });
    }
    
    // Replace the claim text in the paragraph
    const newParagraphText = currentClaim.paragraphText.replace(
      currentClaim.claim.text,
      newClaimText
    );
    
    onUpdateParagraph(currentClaim.paragraphIndex, newParagraphText);
    toast({ title: "Rewrite implemented", description: "The text has been updated." });
  }, [currentClaim, rewriteHistory, onUpdateParagraph]);

  // Handle reverting a rewrite
  const handleRevert = useCallback(() => {
    if (!currentClaim || !currentClaimKey) return;
    
    const historyEntry = rewriteHistory.get(currentClaimKey);
    
    if (historyEntry) {
      // Restore the original paragraph text
      onUpdateParagraph(currentClaim.paragraphIndex, historyEntry.originalParagraphText);
      
      // Remove from history
      setRewriteHistory(prev => {
        const newMap = new Map(prev);
        newMap.delete(currentClaimKey);
        return newMap;
      });
      
      toast({ title: "Reverted", description: "Original text restored." });
    }
  }, [currentClaim, currentClaimKey, rewriteHistory, onUpdateParagraph]);

  // Open source PDF
  const handleOpenSource = useCallback((source: Source, page?: number, searchText?: string) => {
    setViewerSource(source);
    setViewerPage(page || 1);
    setViewerSearchText(searchText);
    setViewerOpen(true);
  }, []);

  // Copy full document
  const copyFullDocument = useCallback(async () => {
    const fullText = paragraphs.map(p => p.text).join('\n\n');
    try {
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  }, [paragraphs]);

  if (allClaims.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12">
        <CheckCircle className="h-12 w-12 text-green-500" />
        <p className="text-lg text-muted-foreground">No claims to review</p>
        <Button onClick={onBack}>Back to Copilot</Button>
      </div>
    );
  }

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
            <span className="font-medium text-sm">
              Claim {selectedClaimIndex + 1} of {allClaims.length}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'claims' | 'document')}>
            <TabsList className="h-8">
              <TabsTrigger value="claims" className="h-7 px-2 text-xs">
                <List className="h-3.5 w-3.5 mr-1" />
                Claims
              </TabsTrigger>
              <TabsTrigger value="document" className="h-7 px-2 text-xs">
                <FileText className="h-3.5 w-3.5 mr-1" />
                Full Text
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex gap-1">
            <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30 text-xs">
              {claimCounts.green} ✓
            </Badge>
            <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/30 text-xs">
              {claimCounts.yellow} !
            </Badge>
            <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30 text-xs">
              {claimCounts.red} ✗
            </Badge>
          </div>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={goToNextProblem}
            disabled={claimCounts.red + claimCounts.yellow === 0}
          >
            <AlertTriangle className="h-4 w-4 mr-1" />
            Next Issue
          </Button>
          <Button variant="outline" size="sm" onClick={copyFullDocument}>
            {copied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {copied ? 'Copied!' : 'Copy All'}
          </Button>
        </div>
      </div>

      {viewMode === 'claims' ? (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* Claims List - Left Panel */}
          <Card className="overflow-hidden">
            <div className="p-3 border-b bg-muted/50">
              <h3 className="font-medium text-sm">All Claims</h3>
            </div>
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="p-2 space-y-1">
                {allClaims.map((item, idx) => {
                  const key = `${item.paragraphIndex}-${item.claimIndex}`;
                  const isModified = rewriteHistory.has(key);
                  
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedClaimIndex(idx)}
                      className={cn(
                        "w-full text-left p-3 rounded-lg transition-colors",
                        "hover:bg-accent/50",
                        selectedClaimIndex === idx 
                          ? "bg-accent border border-primary/30" 
                          : "bg-card border border-transparent"
                      )}
                    >
                      <div className="flex items-start gap-2">
                        <div 
                          className={cn(
                            "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                            item.color === 'green' && "bg-green-500",
                            item.color === 'yellow' && "bg-yellow-500",
                            item.color === 'red' && "bg-red-500",
                            item.color === 'blue' && "bg-blue-500"
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-muted-foreground">
                              ¶{item.paragraphIndex + 1}
                            </span>
                            {isModified && (
                              <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-orange-500/10 text-orange-600 border-orange-500/30">
                                Modified
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm line-clamp-2">
                            {item.claim.text.slice(0, 80)}
                            {item.claim.text.length > 80 ? '...' : ''}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </Card>

          {/* Claim Detail - Right Panel */}
          <div className="space-y-4">
            {/* Navigation */}
            <Card className="p-3">
              <div className="flex items-center justify-between">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={goToPrevClaim}
                  disabled={selectedClaimIndex === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Previous
                </Button>
                
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Paragraph {currentClaim.paragraphIndex + 1}, Claim {currentClaim.claimIndex + 1}
                  </span>
                  <VerdictBadge color={currentClaim.color} />
                  {currentClaimHistory && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleRevert}
                      className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950"
                    >
                      <Undo2 className="h-4 w-4 mr-1" />
                      Revert
                    </Button>
                  )}
                </div>
                
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={goToNextClaim}
                  disabled={selectedClaimIndex === allClaims.length - 1}
                >
                  Next
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            </Card>

            {/* Paragraph Context */}
            <Card className="p-4 bg-muted/30">
              <div className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                Paragraph Context
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-4">
                {currentClaim.paragraphText}
              </p>
            </Card>

            {/* Claim Card */}
            <ClaimCard
              claim={currentClaim.claim}
              sources={sources}
              onOpenSource={handleOpenSource}
              onImplementRewrite={handleImplementRewrite}
              showImplementButton={true}
              originalText={currentClaimHistory?.originalClaimText}
              onRevert={handleRevert}
            />
          </div>
        </div>
      ) : (
        /* Full Document View */
        <Card className="overflow-hidden">
          <div className="p-3 border-b bg-muted/50 flex items-center justify-between">
            <h3 className="font-medium text-sm">Full Document</h3>
            <span className="text-xs text-muted-foreground">{paragraphs.length} paragraphs</span>
          </div>
          <ScrollArea className="h-[calc(100vh-280px)]">
            <div className="p-4 space-y-4">
              {paragraphs.map((p, idx) => {
                // Find claims in this paragraph
                const paragraphClaims = allClaims.filter(c => c.paragraphIndex === p.index);
                const hasIssues = paragraphClaims.some(c => c.color === 'red' || c.color === 'yellow');
                const isModified = paragraphClaims.some(c => rewriteHistory.has(`${c.paragraphIndex}-${c.claimIndex}`));
                
                return (
                  <div
                    key={idx}
                    className={cn(
                      "p-4 rounded-lg border transition-colors",
                      hasIssues ? "border-yellow-500/50 bg-yellow-500/5" : "border-border bg-card",
                      isModified && "ring-2 ring-orange-500/30"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-medium text-muted-foreground">¶{p.index + 1}</span>
                      {p.sectionTitle && (
                        <Badge variant="outline" className="text-xs">{p.sectionTitle}</Badge>
                      )}
                      {p.result && (
                        <VerdictBadge color={p.result.overall_color as 'green' | 'yellow' | 'red' | 'blue'} />
                      )}
                      {isModified && (
                        <Badge variant="outline" className="text-[10px] bg-orange-500/10 text-orange-600 border-orange-500/30">
                          Modified
                        </Badge>
                      )}
                      {paragraphClaims.length > 0 && (
                        <span className="text-xs text-muted-foreground ml-auto">
                          {paragraphClaims.length} claim{paragraphClaims.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap">{p.text}</p>
                    {paragraphClaims.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border/50 space-y-2">
                        {paragraphClaims.map((c, cIdx) => (
                          <button
                            key={cIdx}
                            onClick={() => {
                              const globalIdx = allClaims.findIndex(
                                ac => ac.paragraphIndex === c.paragraphIndex && ac.claimIndex === c.claimIndex
                              );
                              if (globalIdx >= 0) {
                                setSelectedClaimIndex(globalIdx);
                                setViewMode('claims');
                              }
                            }}
                            className="w-full text-left p-2 rounded bg-muted/50 hover:bg-muted transition-colors flex items-start gap-2"
                          >
                            <div 
                              className={cn(
                                "w-2 h-2 rounded-full mt-1.5 flex-shrink-0",
                                c.color === 'green' && "bg-green-500",
                                c.color === 'yellow' && "bg-yellow-500",
                                c.color === 'red' && "bg-red-500",
                                c.color === 'blue' && "bg-blue-500"
                              )}
                            />
                            <span className="text-xs line-clamp-2">{c.claim.text}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </Card>
      )}

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
