import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Copy, Check, AlertTriangle, CheckCircle, Undo2, FileText, List, History, Clock, File } from "lucide-react";
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
import * as pdfjsLib from 'pdfjs-dist';
import { getFile } from "@/lib/client-storage";

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
  thesisFilePath?: string; // Path to original thesis PDF for overlay mode
}

interface FlatClaim {
  claim: Claim;
  paragraphIndex: number;
  claimIndex: number;
  paragraphText: string;
  color: 'green' | 'yellow' | 'red' | 'blue';
  overallColor: string;
}

// Blue paragraph (no claims, just info display)
interface BlueParagraph {
  paragraphIndex: number;
  paragraphText: string;
  sectionTitle?: string;
  skipReason?: string;
}

// Track version history for rewrites
interface VersionEntry {
  text: string;
  paragraphText: string;
  timestamp: Date;
}

interface RewriteHistoryEntry {
  versions: VersionEntry[];
}

export function ThesisEditor({ paragraphs, sources, onBack, onUpdateParagraph, thesisFilePath }: ThesisEditorProps) {
  const [selectedClaimIndex, setSelectedClaimIndex] = useState<number | null>(0);
  const [selectedBlueParagraph, setSelectedBlueParagraph] = useState<BlueParagraph | null>(null);
  const [rewriteHistory, setRewriteHistory] = useState<Map<string, RewriteHistoryEntry>>(new Map());
  const [implementedClaims, setImplementedClaims] = useState<Set<string>>(new Set());
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerSource, setViewerSource] = useState<Source | null>(null);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerSearchText, setViewerSearchText] = useState<string | undefined>(undefined);
  const [viewerHighlightColor, setViewerHighlightColor] = useState<'green' | 'yellow' | 'red' | 'blue' | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [viewMode, setViewMode] = useState<'claims' | 'document' | 'pdf'>('claims');
  const [historyOpen, setHistoryOpen] = useState(false);
  
  // PDF overlay mode state
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [totalPdfPages, setTotalPdfPages] = useState(0);
  const [pdfScale, setPdfScale] = useState(1.0);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [pdfTextContent, setPdfTextContent] = useState<Map<number, string>>(new Map());
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  
  // Helper to select a claim and clear blue paragraph selection
  const selectClaim = useCallback((idx: number) => {
    setSelectedClaimIndex(idx);
    setSelectedBlueParagraph(null);
  }, []);
  
  // Helper to select a blue paragraph and clear claim selection
  const selectBlueParagraph = useCallback((bp: BlueParagraph) => {
    setSelectedBlueParagraph(bp);
    setSelectedClaimIndex(null);
  }, []);

  const getClaimColor = useCallback((claim: Claim, overallColor: string, paragraphIndex: number, claimIndex: number): 'green' | 'yellow' | 'red' | 'blue' => {
    // Check if this claim has been implemented (rewritten) - show as green
    const key = `${paragraphIndex}-${claimIndex}`;
    if (implementedClaims.has(key)) return 'green';
    
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
    
    // Blue for unchecked paragraphs with citations that need verification
    if (overallColor === 'blue') {
      return 'blue';
    }
    
    return overallColor as 'green' | 'yellow' | 'red' | 'blue';
  }, [implementedClaims]);

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
            color: getClaimColor(claim, p.result!.overall_color, p.index, claimIdx),
            overallColor: p.result!.overall_color,
          });
        });
      }
    });
    
    return claims;
  }, [paragraphs, getClaimColor, implementedClaims]);

  // Get list of blue paragraphs (sections that don't need AI verification)
  const blueParagraphs: BlueParagraph[] = useMemo(() => {
    return paragraphs
      .filter(p => p.result?.overall_color === 'blue' && (!p.result?.claims || p.result.claims.length === 0))
      .map(p => ({
        paragraphIndex: p.index,
        paragraphText: p.text,
        sectionTitle: p.sectionTitle,
        skipReason: p.skipReason || p.result?.summary,
      }));
  }, [paragraphs]);

  const currentClaim = selectedClaimIndex !== null ? allClaims[selectedClaimIndex] : null;
  
  // Check if current claim has been modified
  const currentClaimKey = currentClaim ? `${currentClaim.paragraphIndex}-${currentClaim.claimIndex}` : null;
  const currentClaimHistory = currentClaimKey ? rewriteHistory.get(currentClaimKey) : null;
  
  // Count claims by color (and also count blue paragraphs that have no claims)
  const claimCounts = useMemo(() => {
    const counts = { green: 0, yellow: 0, red: 0, blue: 0, total: allClaims.length };
    allClaims.forEach(c => {
      counts[c.color]++;
    });
    counts.blue += blueParagraphs.length;
    return counts;
  }, [allClaims, blueParagraphs.length]);

  // Load PDF for overlay mode
  useEffect(() => {
    if (viewMode === 'pdf' && thesisFilePath && !pdfDoc) {
      loadThesisPdf();
    }
  }, [viewMode, thesisFilePath]);

  // Render PDF page when it changes
  useEffect(() => {
    if (pdfDoc && viewMode === 'pdf') {
      renderPdfPage(currentPdfPage);
    }
  }, [pdfDoc, currentPdfPage, pdfScale, viewMode]);

  const loadThesisPdf = async () => {
    if (!thesisFilePath) return;
    
    setIsPdfLoading(true);
    try {
      let arrayBuffer: ArrayBuffer;
      
      // Check if it's a blob URL (from direct file upload) or a storage path
      if (thesisFilePath.startsWith('blob:')) {
        // Fetch the blob URL directly
        const response = await fetch(thesisFilePath);
        arrayBuffer = await response.arrayBuffer();
      } else {
        // It's a storage path, use getFile
        const file = await getFile(thesisFilePath);
        if (!file) {
          toast({ title: "PDF not found", variant: "destructive" });
          return;
        }
        arrayBuffer = await file.arrayBuffer();
      }
      
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfDoc(pdf);
      setTotalPdfPages(pdf.numPages);
    } catch (err) {
      console.error("Error loading thesis PDF:", err);
      toast({ title: "Failed to load PDF", variant: "destructive" });
    } finally {
      setIsPdfLoading(false);
    }
  };

  const renderPdfPage = async (pageNum: number) => {
    if (!pdfDoc || !pdfCanvasRef.current) return;
    
    try {
      const page = await pdfDoc.getPage(pageNum);
      const canvas = pdfCanvasRef.current;
      const context = canvas.getContext('2d');
      
      if (!context) return;
      
      const viewport = page.getViewport({ scale: pdfScale });
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;
      
      // Draw colored overlays for claims on this page
      // This is a simplified version - in a full implementation you'd map text positions
      drawClaimOverlays(context, viewport);
    } catch (err) {
      console.error("Error rendering PDF page:", err);
    }
  };

  const drawClaimOverlays = (ctx: CanvasRenderingContext2D, viewport: pdfjsLib.PageViewport) => {
    // Get color counts for legend
    const colors = {
      green: { count: claimCounts.green, rgba: 'rgba(34, 197, 94, 0.15)' },
      yellow: { count: claimCounts.yellow, rgba: 'rgba(250, 204, 21, 0.15)' },
      red: { count: claimCounts.red, rgba: 'rgba(239, 68, 68, 0.15)' },
      blue: { count: claimCounts.blue, rgba: 'rgba(59, 130, 246, 0.15)' },
    };
    
    // Draw a simple legend in the corner
    ctx.font = '12px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillText(`Claims: ${claimCounts.green}✓ ${claimCounts.yellow}! ${claimCounts.red}✗`, 10, 20);
  };

  // Navigation
  const goToPrevClaim = useCallback(() => {
    if (selectedClaimIndex === null || selectedClaimIndex === 0) return;
    selectClaim(selectedClaimIndex - 1);
  }, [selectedClaimIndex, selectClaim]);

  const goToNextClaim = useCallback(() => {
    if (selectedClaimIndex === null || selectedClaimIndex >= allClaims.length - 1) return;
    selectClaim(selectedClaimIndex + 1);
  }, [selectedClaimIndex, allClaims.length, selectClaim]);

  const goToNextProblem = useCallback(() => {
    const startIdx = selectedClaimIndex ?? -1;
    // Find next red or yellow claim after current
    for (let i = startIdx + 1; i < allClaims.length; i++) {
      if (allClaims[i].color === 'red' || allClaims[i].color === 'yellow') {
        selectClaim(i);
        return;
      }
    }
    // Wrap around
    for (let i = 0; i < startIdx; i++) {
      if (allClaims[i].color === 'red' || allClaims[i].color === 'yellow') {
        selectClaim(i);
        return;
      }
    }
    toast({ title: "No more issues", description: "All claims are verified." });
  }, [selectedClaimIndex, allClaims, selectClaim]);

  // Handle implementing a rewrite
  const handleImplementRewrite = useCallback((newClaimText: string) => {
    if (!currentClaim) return;
    
    const key = `${currentClaim.paragraphIndex}-${currentClaim.claimIndex}`;
    
    // Add current state to version history
    setRewriteHistory(prev => {
      const newMap = new Map(prev);
      const existing = prev.get(key);
      const newVersion: VersionEntry = {
        text: currentClaim.claim.text,
        paragraphText: currentClaim.paragraphText,
        timestamp: new Date(),
      };
      
      if (existing) {
        newMap.set(key, { versions: [...existing.versions, newVersion] });
      } else {
        newMap.set(key, { versions: [newVersion] });
      }
      return newMap;
    });
    
    // Mark claim as implemented (green)
    setImplementedClaims(prev => new Set(prev).add(key));
    
    // Replace the claim text in the paragraph
    const newParagraphText = currentClaim.paragraphText.replace(
      currentClaim.claim.text,
      newClaimText
    );
    
    onUpdateParagraph(currentClaim.paragraphIndex, newParagraphText);
    toast({ title: "Rewrite implemented", description: "The text has been updated and marked as resolved." });
  }, [currentClaim, onUpdateParagraph]);

  // Handle reverting to a specific version
  const handleRevertToVersion = useCallback((versionIndex: number) => {
    if (!currentClaim || !currentClaimKey) return;
    
    const historyEntry = rewriteHistory.get(currentClaimKey);
    if (!historyEntry || !historyEntry.versions[versionIndex]) return;
    
    const version = historyEntry.versions[versionIndex];
    
    // Restore that version's paragraph text
    onUpdateParagraph(currentClaim.paragraphIndex, version.paragraphText);
    
    // Keep only versions up to (but not including) the one we reverted to
    setRewriteHistory(prev => {
      const newMap = new Map(prev);
      if (versionIndex === 0) {
        newMap.delete(currentClaimKey);
      } else {
        newMap.set(currentClaimKey, { versions: historyEntry.versions.slice(0, versionIndex) });
      }
      return newMap;
    });
    
    // If reverting to original (index 0), remove from implemented
    if (versionIndex === 0) {
      setImplementedClaims(prev => {
        const newSet = new Set(prev);
        newSet.delete(currentClaimKey);
        return newSet;
      });
    }
    
    setHistoryOpen(false);
    toast({ title: "Reverted", description: `Restored to version from ${version.timestamp.toLocaleTimeString()}` });
  }, [currentClaim, currentClaimKey, rewriteHistory, onUpdateParagraph]);

  // Handle reverting to original (convenience wrapper)
  const handleRevert = useCallback(() => {
    handleRevertToVersion(0);
  }, [handleRevertToVersion]);

  // Open source PDF with color
  const handleOpenSource = useCallback((source: Source, page?: number, searchText?: string) => {
    setViewerSource(source);
    setViewerPage(page || 1);
    setViewerSearchText(searchText);
    // Pass the current claim's color to the PDF viewer
    setViewerHighlightColor(currentClaim?.color);
    setViewerOpen(true);
  }, [currentClaim?.color]);

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
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'claims' | 'document' | 'pdf')}>
            <TabsList className="h-8">
              <TabsTrigger value="claims" className="h-7 px-2 text-xs">
                <List className="h-3.5 w-3.5 mr-1" />
                Claims
              </TabsTrigger>
              <TabsTrigger value="document" className="h-7 px-2 text-xs">
                <FileText className="h-3.5 w-3.5 mr-1" />
                Full Text
              </TabsTrigger>
              {thesisFilePath && (
                <TabsTrigger value="pdf" className="h-7 px-2 text-xs">
                  <File className="h-3.5 w-3.5 mr-1" />
                  PDF
                </TabsTrigger>
              )}
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
            {claimCounts.blue > 0 && (
              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-xs">
                {claimCounts.blue} ?
              </Badge>
            )}
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
                      onClick={() => selectClaim(idx)}
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
                  {currentClaimHistory && currentClaimHistory.versions.length > 0 && (
                    <div className="flex items-center gap-1">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setHistoryOpen(!historyOpen)}
                        className="text-blue-600 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950"
                      >
                        <History className="h-4 w-4 mr-1" />
                        History ({currentClaimHistory.versions.length})
                      </Button>
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={handleRevert}
                        className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950"
                      >
                        <Undo2 className="h-4 w-4 mr-1" />
                        Revert
                      </Button>
                    </div>
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

            {/* Version History Panel */}
            {historyOpen && currentClaimHistory && currentClaimHistory.versions.length > 0 && (
              <Card className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Version History
                  </h4>
                  <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(false)} className="h-6 text-xs">
                    Close
                  </Button>
                </div>
                <div className="space-y-2">
                  {currentClaimHistory.versions.map((version, idx) => (
                    <div 
                      key={idx} 
                      className="flex items-start justify-between gap-2 p-2 bg-background rounded border"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-[10px]">
                            v{idx + 1}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {version.timestamp.toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">
                          {version.text.slice(0, 100)}...
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRevertToVersion(idx)}
                        className="h-7 text-xs flex-shrink-0"
                      >
                        Restore
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            )}

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
              originalText={currentClaimHistory?.versions[0]?.text}
              onRevert={handleRevert}
              highlightColor={currentClaim.color}
            />
          </div>
        </div>
      ) : viewMode === 'document' ? (
        /* Full Document View with inline highlights */
        <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
          {/* Document with inline highlights - Left Panel */}
          <Card className="overflow-hidden">
            <div className="p-3 border-b bg-muted/50 flex items-center justify-between">
              <h3 className="font-medium text-sm">Full Document</h3>
              <span className="text-xs text-muted-foreground">{paragraphs.length} paragraphs</span>
            </div>
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="p-6 space-y-1 text-left">
                {paragraphs.map((p, idx) => {
                  const paragraphClaims = allClaims.filter(c => c.paragraphIndex === p.index);
                  
                  // Render paragraph with inline highlighted claims
                  const renderTextWithHighlights = () => {
                    if (paragraphClaims.length === 0) {
                      // Show blue background for:
                      // 1. Unchecked paragraphs with citations
                      // 2. Checked paragraphs with blue status (sections that don't need AI verification)
                      const hasCitationPattern = /\([^)]*\d{4}[^)]*\)/.test(p.text);
                      const isBlueStatus = p.result?.overall_color === 'blue';
                      if ((!p.checked && hasCitationPattern) || isBlueStatus) {
                        const bp: BlueParagraph = {
                          paragraphIndex: p.index,
                          paragraphText: p.text,
                          sectionTitle: p.sectionTitle,
                          skipReason: p.skipReason || p.result?.summary,
                        };
                        const isSelected = selectedBlueParagraph?.paragraphIndex === p.index;
                        return (
                          <button
                            onClick={() => selectBlueParagraph(bp)}
                            className={cn(
                              "bg-blue-500/10 rounded px-0.5 text-left transition-all cursor-pointer hover:ring-2 hover:ring-blue-500/50",
                              isSelected && "ring-2 ring-blue-500"
                            )}
                          >
                            {p.text}
                          </button>
                        );
                      }
                      return <span>{p.text}</span>;
                    }

                    // Sort claims by their position in the text
                    const sortedClaims = [...paragraphClaims].sort((a, b) => {
                      const posA = p.text.indexOf(a.claim.text);
                      const posB = p.text.indexOf(b.claim.text);
                      return posA - posB;
                    });

                    const elements: React.ReactNode[] = [];
                    let lastEnd = 0;

                    sortedClaims.forEach((c, cIdx) => {
                      const start = p.text.indexOf(c.claim.text, lastEnd);
                      if (start === -1) return;

                      // Add text before this claim
                      if (start > lastEnd) {
                        elements.push(
                          <span key={`text-${cIdx}`}>{p.text.slice(lastEnd, start)}</span>
                        );
                      }

                      const globalIdx = allClaims.findIndex(
                        ac => ac.paragraphIndex === c.paragraphIndex && ac.claimIndex === c.claimIndex
                      );
                      const isSelected = selectedClaimIndex === globalIdx;
                      const claimKey = `${c.paragraphIndex}-${c.claimIndex}`;
                      const isModified = rewriteHistory.has(claimKey);

                      // Add highlighted claim
                      elements.push(
                        <button
                          key={`claim-${cIdx}`}
                          onClick={() => selectClaim(globalIdx)}
                          className={cn(
                            "rounded px-0.5 -mx-0.5 transition-all cursor-pointer hover:ring-2 hover:ring-primary/50",
                            c.color === 'green' && "bg-green-500/20 hover:bg-green-500/30",
                            c.color === 'yellow' && "bg-yellow-500/30 hover:bg-yellow-500/40",
                            c.color === 'red' && "bg-red-500/30 hover:bg-red-500/40",
                            c.color === 'blue' && "bg-blue-500/20 hover:bg-blue-500/30",
                            isSelected && "ring-2 ring-primary",
                            isModified && "underline decoration-orange-500 decoration-2"
                          )}
                        >
                          {c.claim.text}
                        </button>
                      );

                      lastEnd = start + c.claim.text.length;
                    });

                    // Add remaining text
                    if (lastEnd < p.text.length) {
                      elements.push(
                        <span key="text-end">{p.text.slice(lastEnd)}</span>
                      );
                    }

                    return elements;
                  };

                  return (
                    <div key={idx} className="mb-4">
                      {p.sectionTitle && (
                        <div className="font-semibold text-base mb-2">{p.sectionTitle}</div>
                      )}
                      <p className="text-sm leading-relaxed">
                        {renderTextWithHighlights()}
                      </p>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </Card>

          {/* Claim Detail - Right Panel */}
          <div className="space-y-4">
            {currentClaim ? (
              <>
                {/* Navigation */}
                <Card className="p-3">
                  <div className="flex items-center justify-between">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={goToPrevClaim}
                      disabled={selectedClaimIndex === null || selectedClaimIndex === 0}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Prev
                    </Button>
                    
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        ¶{currentClaim.paragraphIndex + 1}
                      </span>
                      <VerdictBadge color={currentClaim.color} />
                      {currentClaimHistory && currentClaimHistory.versions.length > 0 && (
                        <div className="flex items-center gap-1">
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={() => setHistoryOpen(!historyOpen)}
                            className="text-blue-600 border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950 h-7 text-xs"
                          >
                            <History className="h-3 w-3 mr-1" />
                            {currentClaimHistory.versions.length}
                          </Button>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            onClick={handleRevert}
                            className="text-orange-600 border-orange-300 hover:bg-orange-50 dark:hover:bg-orange-950 h-7 text-xs"
                          >
                            <Undo2 className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                    </div>
                    
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={goToNextClaim}
                      disabled={selectedClaimIndex === null || selectedClaimIndex === allClaims.length - 1}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </Card>

                {/* Version History Panel */}
                {historyOpen && currentClaimHistory && currentClaimHistory.versions.length > 0 && (
                  <Card className="p-3 bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Version History
                      </h4>
                      <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(false)} className="h-6 text-xs">
                        Close
                      </Button>
                    </div>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {currentClaimHistory.versions.map((version, idx) => (
                        <div 
                          key={idx} 
                          className="flex items-start justify-between gap-2 p-2 bg-background rounded border"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Badge variant="outline" className="text-[10px]">
                                v{idx + 1}
                              </Badge>
                              <span className="text-[10px] text-muted-foreground">
                                {version.timestamp.toLocaleTimeString()}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground line-clamp-2">
                              {version.text.slice(0, 80)}...
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRevertToVersion(idx)}
                            className="h-6 text-xs flex-shrink-0"
                          >
                            Restore
                          </Button>
                        </div>
                      ))}
                    </div>
                  </Card>
                )}

                {/* Claim Card */}
                <ClaimCard
                  claim={currentClaim.claim}
                  sources={sources}
                  onOpenSource={handleOpenSource}
                  onImplementRewrite={handleImplementRewrite}
                  showImplementButton={true}
                  originalText={currentClaimHistory?.versions[0]?.text}
                  onRevert={handleRevert}
                  highlightColor={currentClaim.color}
                />
              </>
            ) : selectedBlueParagraph ? (
              /* Blue Paragraph Info Panel */
              <Card className="p-4 bg-blue-500/5 border-blue-500/20">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <VerdictBadge color="blue" />
                    <span className="text-sm font-medium">
                      Paragraph {selectedBlueParagraph.paragraphIndex + 1}
                    </span>
                  </div>
                  
                  {selectedBlueParagraph.sectionTitle && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Section</div>
                      <p className="text-sm font-medium">{selectedBlueParagraph.sectionTitle}</p>
                    </div>
                  )}
                  
                  <div>
                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Status</div>
                    <p className="text-sm">{selectedBlueParagraph.skipReason || 'This section does not require citation verification.'}</p>
                  </div>
                  
                  <div>
                    <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Content Preview</div>
                    <div className="text-sm text-muted-foreground bg-muted/50 rounded p-3 max-h-48 overflow-y-auto">
                      {selectedBlueParagraph.paragraphText.slice(0, 500)}
                      {selectedBlueParagraph.paragraphText.length > 500 && '...'}
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-6 text-center text-muted-foreground">
                <p className="text-sm">Click on a highlighted section to view details</p>
              </Card>
            )}
          </div>
        </div>
      ) : (
        /* PDF Overlay View */
        <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
          {/* PDF Viewer - Left Panel */}
          <Card className="overflow-hidden">
            <div className="p-3 border-b bg-muted/50 flex items-center justify-between">
              <h3 className="font-medium text-sm">Thesis PDF</h3>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPdfPage(p => Math.max(1, p - 1))}
                  disabled={currentPdfPage <= 1 || isPdfLoading}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs text-muted-foreground">
                  {currentPdfPage} / {totalPdfPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPdfPage(p => Math.min(totalPdfPages, p + 1))}
                  disabled={currentPdfPage >= totalPdfPages || isPdfLoading}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPdfScale(s => Math.max(0.5, s - 0.25))}
                  disabled={pdfScale <= 0.5}
                >
                  -
                </Button>
                <span className="text-xs">{Math.round(pdfScale * 100)}%</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPdfScale(s => Math.min(2, s + 0.25))}
                  disabled={pdfScale >= 2}
                >
                  +
                </Button>
              </div>
            </div>
            <ScrollArea className="h-[calc(100vh-280px)]" ref={pdfContainerRef}>
              <div className="p-4 flex justify-center">
                {isPdfLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <div className="animate-spin h-4 w-4 border-2 border-primary border-t-transparent rounded-full" />
                    Loading PDF...
                  </div>
                ) : !thesisFilePath ? (
                  <div className="text-muted-foreground text-sm">
                    PDF not available. Upload a PDF thesis to use this view.
                  </div>
                ) : (
                  <canvas 
                    ref={pdfCanvasRef} 
                    className="shadow-lg bg-background"
                    style={{ maxWidth: '100%', height: 'auto' }}
                  />
                )}
              </div>
            </ScrollArea>
          </Card>

          {/* Claim Detail - Right Panel (same as document view) */}
          <div className="space-y-4">
            {currentClaim ? (
              <>
                {/* Navigation */}
                <Card className="p-3">
                  <div className="flex items-center justify-between">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={goToPrevClaim}
                      disabled={selectedClaimIndex === null || selectedClaimIndex === 0}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Prev
                    </Button>
                    
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        ¶{currentClaim.paragraphIndex + 1}
                      </span>
                      <VerdictBadge color={currentClaim.color} />
                    </div>
                    
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={goToNextClaim}
                      disabled={selectedClaimIndex === null || selectedClaimIndex === allClaims.length - 1}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </Card>

                {/* Claim Card */}
                <ClaimCard
                  claim={currentClaim.claim}
                  sources={sources}
                  onOpenSource={handleOpenSource}
                  onImplementRewrite={handleImplementRewrite}
                  showImplementButton={true}
                  originalText={currentClaimHistory?.versions[0]?.text}
                  onRevert={handleRevert}
                  highlightColor={currentClaim.color}
                />
              </>
            ) : selectedBlueParagraph ? (
              /* Blue Paragraph Info Panel */
              <Card className="p-4 bg-blue-500/5 border-blue-500/20">
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <VerdictBadge color="blue" />
                    <span className="text-sm font-medium">
                      Paragraph {selectedBlueParagraph.paragraphIndex + 1}
                    </span>
                  </div>
                  
                  {selectedBlueParagraph.sectionTitle && (
                    <div>
                      <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Section</div>
                      <p className="text-sm font-medium">{selectedBlueParagraph.sectionTitle}</p>
                    </div>
                  )}
                  
                  <div>
                    <div className="text-xs text-muted-foreground mb-1 uppercase tracking-wide">Status</div>
                    <p className="text-sm">{selectedBlueParagraph.skipReason || 'This section does not require citation verification.'}</p>
                  </div>
                  
                  <div>
                    <div className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Content Preview</div>
                    <div className="text-sm text-muted-foreground bg-muted/50 rounded p-3 max-h-48 overflow-y-auto">
                      {selectedBlueParagraph.paragraphText.slice(0, 500)}
                      {selectedBlueParagraph.paragraphText.length > 500 && '...'}
                    </div>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-6 text-center text-muted-foreground">
                <p className="text-sm">Select a claim to view details</p>
              </Card>
            )}
          </div>
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
