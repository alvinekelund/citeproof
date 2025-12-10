import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Copy, Check, AlertTriangle, CheckCircle, Undo2, FileText, List, History, Clock, File } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { CheckResult as CheckResultType, Source, Claim, generateClaimDisplayId } from "@/lib/types";
import { ClaimCard } from "./ClaimCard";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { PdfViewerDialog } from "@/components/sources/PdfViewerDialog";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import * as pdfjsLib from 'pdfjs-dist';
import { getFile } from "@/lib/client-storage";
import { 
  buildPdfTextMap, 
  findBestPageForParagraph, 
  extractPageTextRegions, 
  findMatchingRegions, 
  findClaimRegions,
  getBoundingBox,
  buildPageTextFromRegions,
  PdfTextMap,
  TextRegion 
} from "@/lib/pdf-text-map";
import { normalizeText, createParagraphAnchors, ParagraphAnchor } from "@/lib/text-anchors";

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
  thesisFilePath?: string;
}

interface FlatClaim {
  claim: Claim;
  paragraphIndex: number;
  claimIndex: number;
  paragraphText: string;
  color: 'green' | 'yellow' | 'red' | 'blue';
  overallColor: string;
  displayId: string; // Hierarchical ID like "1.1", "1.2"
  paragraphDisplayIndex: number; // 1-based paragraph number (only counting paragraphs with claims)
}

interface BlueParagraph {
  paragraphIndex: number;
  paragraphText: string;
  sectionTitle?: string;
  skipReason?: string;
}

interface VersionEntry {
  text: string;
  paragraphText: string;
  timestamp: Date;
}

interface RewriteHistoryEntry {
  versions: VersionEntry[];
}

interface ClickableRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  paragraphIndex: number;
  claimIndex: number | null;
  globalClaimIndex: number | null;
  color: 'green' | 'yellow' | 'red' | 'blue';
  displayId: string; // For debugging and display
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
  // Main view: PDF or Full Text
  const [viewMode, setViewMode] = useState<'document' | 'pdf'>(thesisFilePath ? 'pdf' : 'document');
  // Sidebar mode: Claims or Paragraphs list
  const [sidebarMode, setSidebarMode] = useState<'claims' | 'paragraphs'>('claims');
  const [historyOpen, setHistoryOpen] = useState(false);
  
  // PDF overlay mode state
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPdfPage, setCurrentPdfPage] = useState(1);
  const [totalPdfPages, setTotalPdfPages] = useState(0);
  const [pdfScale, setPdfScale] = useState(1.0);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  
  // PDF text mapping for page navigation
  const [pdfTextMap, setPdfTextMap] = useState<PdfTextMap | null>(null);
  const [paragraphAnchors, setParagraphAnchors] = useState<ParagraphAnchor[]>([]);
  
  // Store clickable regions for PDF highlights
  const [pdfClickableRegions, setPdfClickableRegions] = useState<ClickableRegion[]>([]);
  const [hoveredRegion, setHoveredRegion] = useState<ClickableRegion | null>(null);
  
  // Track if we should auto-navigate to claim's page
  const [shouldAutoNavigate, setShouldAutoNavigate] = useState(false);
  
  const selectClaim = useCallback((idx: number) => {
    setSelectedClaimIndex(idx);
    setSelectedBlueParagraph(null);
    setShouldAutoNavigate(true);
  }, []);
  
  const selectBlueParagraph = useCallback((bp: BlueParagraph) => {
    setSelectedBlueParagraph(bp);
    setSelectedClaimIndex(null);
  }, []);

  const getClaimColor = useCallback((claim: Claim, overallColor: string, paragraphIndex: number, claimIndex: number): 'green' | 'yellow' | 'red' | 'blue' => {
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
    
    if (overallColor === 'blue') {
      return 'blue';
    }
    
    return overallColor as 'green' | 'yellow' | 'red' | 'blue';
  }, [implementedClaims]);

  // Build allClaims with hierarchical display IDs
  const allClaims: FlatClaim[] = useMemo(() => {
    const claims: FlatClaim[] = [];
    
    // First, find all paragraphs that have claims and assign display indices
    const paragraphsWithClaims: number[] = [];
    paragraphs.forEach((p) => {
      if (p.checked && p.result?.claims && p.result.claims.length > 0) {
        paragraphsWithClaims.push(p.index);
      }
    });
    
    // Now build flat claims with proper display IDs
    paragraphs.forEach((p) => {
      if (p.checked && p.result?.claims) {
        const paragraphDisplayIndex = paragraphsWithClaims.indexOf(p.index) + 1; // 1-based
        
        p.result.claims.forEach((claim, claimIdx) => {
          const displayId = generateClaimDisplayId(paragraphDisplayIndex, claimIdx + 1);
          claims.push({
            claim,
            paragraphIndex: p.index,
            claimIndex: claimIdx,
            paragraphText: p.text,
            color: getClaimColor(claim, p.result!.overall_color, p.index, claimIdx),
            overallColor: p.result!.overall_color,
            displayId,
            paragraphDisplayIndex,
          });
        });
      }
    });
    
    return claims;
  }, [paragraphs, getClaimColor]);

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

  useEffect(() => {
    const texts = paragraphs.map(p => p.text);
    const anchors = createParagraphAnchors(texts);
    setParagraphAnchors(anchors);
  }, [paragraphs]);

  const currentClaim = selectedClaimIndex !== null ? allClaims[selectedClaimIndex] : null;
  
  const currentClaimKey = currentClaim ? `${currentClaim.paragraphIndex}-${currentClaim.claimIndex}` : null;
  const currentClaimHistory = currentClaimKey ? rewriteHistory.get(currentClaimKey) : null;
  
  const claimCounts = useMemo(() => {
    const counts = { green: 0, yellow: 0, red: 0, blue: 0, total: allClaims.length };
    allClaims.forEach(c => {
      counts[c.color]++;
    });
    counts.blue += blueParagraphs.length;
    return counts;
  }, [allClaims, blueParagraphs.length]);

  // Update viewMode when thesisFilePath becomes available
  useEffect(() => {
    if (thesisFilePath && viewMode === 'document') {
      setViewMode('pdf');
    }
  }, [thesisFilePath]);

  useEffect(() => {
    if (thesisFilePath && !pdfDoc && !isPdfLoading) {
      loadThesisPdf();
    }
  }, [thesisFilePath]);

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
      
      if (thesisFilePath.startsWith('blob:')) {
        const response = await fetch(thesisFilePath);
        arrayBuffer = await response.arrayBuffer();
      } else {
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
      
      console.log('[PDF] Building text map...');
      const textMap = await buildPdfTextMap(pdf);
      setPdfTextMap(textMap);
      console.log('[PDF] Text map built:', textMap.totalPages, 'pages,', textMap.fullText.length, 'chars');
    } catch (err) {
      console.error("Error loading thesis PDF:", err);
      toast({ title: "Failed to load PDF", variant: "destructive" });
    } finally {
      setIsPdfLoading(false);
    }
  };

  // Auto-navigate to claim's page when claim is selected in PDF view
  useEffect(() => {
    if (!shouldAutoNavigate || !pdfTextMap || !currentClaim || viewMode !== 'pdf') return;
    
    const paragraphText = currentClaim.paragraphText;
    const targetPage = findBestPageForParagraph(pdfTextMap, paragraphText);
    
    if (targetPage !== currentPdfPage) {
      console.log('[PDF] Auto-navigating to page', targetPage, 'for claim', currentClaim.displayId);
      setCurrentPdfPage(targetPage);
    }
    
    setShouldAutoNavigate(false);
  }, [shouldAutoNavigate, pdfTextMap, currentClaim, viewMode, currentPdfPage]);

  const renderPdfPage = async (pageNum: number) => {
    if (!pdfDoc || !pdfCanvasRef.current) return;
    
    // Cancel any pending render operation
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch (e) {
        // Ignore cancel errors
      }
      renderTaskRef.current = null;
    }
    
    try {
      const page = await pdfDoc.getPage(pageNum);
      const canvas = pdfCanvasRef.current;
      const context = canvas.getContext('2d');
      
      if (!context) return;
      
      const viewport = page.getViewport({ scale: pdfScale });
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      const renderTask = page.render({
        canvasContext: context,
        viewport: viewport,
      });
      renderTaskRef.current = renderTask;
      
      await renderTask.promise;
      renderTaskRef.current = null;
      
      // Draw overlays after rendering
      await drawTextOverlays(context, viewport, pdfDoc);
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error("Error rendering PDF page:", err);
      }
    }
  };

  // Draw text overlays on the PDF - per-text-item precision for proper line-level highlighting
  const drawTextOverlays = async (
    ctx: CanvasRenderingContext2D, 
    viewport: pdfjsLib.PageViewport,
    pdf: pdfjsLib.PDFDocumentProxy
  ) => {
    const colorMap: Record<string, string> = {
      green: 'rgba(34, 197, 94, 0.25)',
      yellow: 'rgba(250, 204, 21, 0.30)',
      red: 'rgba(239, 68, 68, 0.25)',
      blue: 'rgba(59, 130, 246, 0.20)',
    };

    const regions: ClickableRegion[] = [];
    
    // Extract text regions with positions from current page
    const pageTextRegions = await extractPageTextRegions(pdf, currentPdfPage, viewport);
    
    if (pageTextRegions.length === 0) {
      console.log('[PDF] No text regions found on page', currentPdfPage);
      setPdfClickableRegions([]);
      return;
    }

    // Track which regions have been highlighted to avoid double-highlighting
    const highlightedRegionIndices = new Set<number>();

    // For each checked paragraph, try to find it on this page
    for (const p of paragraphs) {
      if (!p.checked || !p.result) continue;
      
      const overallColor = p.result.overall_color as 'green' | 'yellow' | 'red' | 'blue';
      
      // Try to find the paragraph text in this page's regions
      const matchedRegions = findMatchingRegions(pageTextRegions, p.text);
      
      if (matchedRegions.length === 0) continue; // Paragraph not on this page
      
      // If paragraph has claims, highlight each claim individually
      if (p.result.claims && p.result.claims.length > 0) {
        for (let claimIdx = 0; claimIdx < p.result.claims.length; claimIdx++) {
          const claim = p.result.claims[claimIdx];
          const claimColor = getClaimColor(claim, overallColor, p.index, claimIdx);
          const fillColor = colorMap[claimColor];
          
          // Find the global claim index for this claim
          const globalClaimIdx = allClaims.findIndex(
            c => c.paragraphIndex === p.index && c.claimIndex === claimIdx
          );
          const displayId = globalClaimIdx >= 0 ? allClaims[globalClaimIdx].displayId : `${p.index}.${claimIdx}`;
          
          // Find claim-specific regions within the paragraph
          const claimRegions = findClaimRegions(matchedRegions, claim.text);
          
          if (claimRegions.length > 0) {
            // Draw highlight for EACH individual text region (not bounding box)
            // This gives line-level precision
            for (const region of claimRegions) {
              ctx.fillStyle = fillColor;
              ctx.fillRect(region.x, region.y, region.width, region.height);
            }
            
            // Create a single clickable region using the overall bounding box
            const claimBox = getBoundingBox(claimRegions);
            if (claimBox) {
              regions.push({
                x: claimBox.x - 2,
                y: claimBox.y - 2,
                width: claimBox.width + 4,
                height: claimBox.height + 4,
                paragraphIndex: p.index,
                claimIndex: claimIdx,
                globalClaimIndex: globalClaimIdx >= 0 ? globalClaimIdx : null,
                color: claimColor,
                displayId,
              });
            }
          }
          // No fallback - if claim not found precisely, don't highlight it
        }
      } else {
        // No claims - highlight individual regions (not full bounding box)
        const fillColor = colorMap[overallColor] || colorMap.blue;
        
        for (const region of matchedRegions) {
          ctx.fillStyle = fillColor;
          ctx.fillRect(region.x, region.y, region.width, region.height);
        }
        
        const paragraphBox = getBoundingBox(matchedRegions);
        if (paragraphBox) {
          regions.push({
            x: paragraphBox.x - 2,
            y: paragraphBox.y - 2,
            width: paragraphBox.width + 4,
            height: paragraphBox.height + 4,
            paragraphIndex: p.index,
            claimIndex: null,
            globalClaimIndex: null,
            color: overallColor,
            displayId: `P${p.index + 1}`,
          });
        }
      }
    }
    
    console.log('[PDF] Created', regions.length, 'clickable regions on page', currentPdfPage);
    setPdfClickableRegions(regions);
  };

  const getCanvasCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    if (!pdfCanvasRef.current) return null;
    
    const canvas = pdfCanvasRef.current;
    const rect = canvas.getBoundingClientRect();
    
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    
    return { x, y };
  }, []);

  const findRegionAtPoint = useCallback((x: number, y: number, tolerance: number = 5): ClickableRegion | null => {
    // Sort regions by area (smaller first) to prefer more specific matches
    const sortedRegions = [...pdfClickableRegions].sort((a, b) => 
      (a.width * a.height) - (b.width * b.height)
    );
    
    for (const region of sortedRegions) {
      const inX = x >= (region.x - tolerance) && x <= (region.x + region.width + tolerance);
      const inY = y >= (region.y - tolerance) && y <= (region.y + region.height + tolerance);
      
      if (inX && inY) {
        return region;
      }
    }
    return null;
  }, [pdfClickableRegions]);

  const handlePdfCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e);
    if (!coords) return;
    
    console.log('[PDF Click] at', coords.x.toFixed(0), coords.y.toFixed(0));
    
    const region = findRegionAtPoint(coords.x, coords.y, 15);
    
    if (region) {
      console.log('[PDF Click] Hit region', region.displayId, 'claim idx', region.globalClaimIndex);
      if (region.globalClaimIndex !== null) {
        selectClaim(region.globalClaimIndex);
      } else {
        const bluePara = blueParagraphs.find(bp => bp.paragraphIndex === region.paragraphIndex);
        if (bluePara) {
          selectBlueParagraph(bluePara);
        }
      }
    }
  }, [getCanvasCoordinates, findRegionAtPoint, selectClaim, selectBlueParagraph, blueParagraphs]);

  const handlePdfCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const coords = getCanvasCoordinates(e);
    if (!coords) {
      if (hoveredRegion) setHoveredRegion(null);
      return;
    }
    
    const region = findRegionAtPoint(coords.x, coords.y, 3);
    
    if (region) {
      if (!hoveredRegion || hoveredRegion.displayId !== region.displayId) {
        setHoveredRegion(region);
        if (pdfCanvasRef.current) {
          pdfCanvasRef.current.style.cursor = 'pointer';
        }
      }
    } else {
      if (hoveredRegion) {
        setHoveredRegion(null);
        if (pdfCanvasRef.current) {
          pdfCanvasRef.current.style.cursor = 'default';
        }
      }
    }
  }, [getCanvasCoordinates, findRegionAtPoint, hoveredRegion]);

  const handlePdfCanvasLeave = useCallback(() => {
    setHoveredRegion(null);
    if (pdfCanvasRef.current) {
      pdfCanvasRef.current.style.cursor = 'default';
    }
  }, []);

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
    for (let i = startIdx + 1; i < allClaims.length; i++) {
      if (allClaims[i].color === 'red' || allClaims[i].color === 'yellow') {
        selectClaim(i);
        return;
      }
    }
    for (let i = 0; i < startIdx; i++) {
      if (allClaims[i].color === 'red' || allClaims[i].color === 'yellow') {
        selectClaim(i);
        return;
      }
    }
    toast({ title: "No more issues", description: "All claims are verified." });
  }, [selectedClaimIndex, allClaims, selectClaim]);

  const handleImplementRewrite = useCallback((newClaimText: string) => {
    if (!currentClaim) return;
    
    const key = `${currentClaim.paragraphIndex}-${currentClaim.claimIndex}`;
    
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
    
    setImplementedClaims(prev => new Set(prev).add(key));
    
    const newParagraphText = currentClaim.paragraphText.replace(
      currentClaim.claim.text,
      newClaimText
    );
    
    onUpdateParagraph(currentClaim.paragraphIndex, newParagraphText);
    toast({ title: "Rewrite implemented", description: "The text has been updated and marked as resolved." });
  }, [currentClaim, onUpdateParagraph]);

  const handleRevertToVersion = useCallback((versionIndex: number) => {
    if (!currentClaim || !currentClaimKey) return;
    
    const historyEntry = rewriteHistory.get(currentClaimKey);
    if (!historyEntry || !historyEntry.versions[versionIndex]) return;
    
    const version = historyEntry.versions[versionIndex];
    
    onUpdateParagraph(currentClaim.paragraphIndex, version.paragraphText);
    
    setRewriteHistory(prev => {
      const newMap = new Map(prev);
      if (versionIndex === 0) {
        newMap.delete(currentClaimKey);
      } else {
        newMap.set(currentClaimKey, { versions: historyEntry.versions.slice(0, versionIndex) });
      }
      return newMap;
    });
    
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

  const handleRevert = useCallback(() => {
    handleRevertToVersion(0);
  }, [handleRevertToVersion]);

  const handleOpenSource = useCallback((source: Source, page?: number, searchText?: string) => {
    setViewerSource(source);
    setViewerPage(page || 1);
    setViewerSearchText(searchText);
    setViewerHighlightColor(currentClaim?.color);
    setViewerOpen(true);
  }, [currentClaim?.color]);

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
              Claim {currentClaim?.displayId || '-'} ({(selectedClaimIndex ?? 0) + 1} of {allClaims.length})
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Main view toggle: PDF | Full Text */}
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as 'document' | 'pdf')}>
            <TabsList className="h-8">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>
                      <TabsTrigger value="pdf" className="h-7 px-2 text-xs" disabled={!thesisFilePath}>
                        <File className="h-3.5 w-3.5 mr-1" />
                        PDF
                      </TabsTrigger>
                    </span>
                  </TooltipTrigger>
                  {!thesisFilePath && (
                    <TooltipContent>
                      <p>PDF not available. Upload a PDF thesis file to use this view.</p>
                    </TooltipContent>
                  )}
                </Tooltip>
              </TooltipProvider>
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

      {viewMode === 'pdf' ? (
        /* PDF Overlay View - Now the default */
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
              <div className="p-4 flex justify-center min-h-[400px]">
                {isPdfLoading ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground justify-center">
                    <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                    <span>Loading PDF...</span>
                  </div>
                ) : !thesisFilePath ? (
                  <div className="flex flex-col items-center gap-3 text-muted-foreground justify-center">
                    <File className="h-12 w-12 opacity-30" />
                    <div className="text-center">
                      <p className="font-medium">PDF not available</p>
                      <p className="text-sm mt-1">Upload a PDF thesis file to use this view.</p>
                    </div>
                  </div>
                ) : !pdfDoc ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground justify-center">
                    <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
                    <span>Preparing PDF...</span>
                  </div>
                ) : (
                  <div className="relative inline-block">
                    <canvas 
                      ref={pdfCanvasRef} 
                      className="shadow-lg bg-background block"
                      onClick={handlePdfCanvasClick}
                      onMouseMove={handlePdfCanvasMove}
                      onMouseLeave={handlePdfCanvasLeave}
                    />
                    {hoveredRegion && pdfCanvasRef.current && (
                      <div
                        className="absolute pointer-events-none border-2 rounded-sm"
                        style={{
                          left: `${(hoveredRegion.x / pdfCanvasRef.current.width) * 100}%`,
                          top: `${(hoveredRegion.y / pdfCanvasRef.current.height) * 100}%`,
                          width: `${(hoveredRegion.width / pdfCanvasRef.current.width) * 100}%`,
                          height: `${(hoveredRegion.height / pdfCanvasRef.current.height) * 100}%`,
                          borderColor: hoveredRegion.color === 'green' ? 'rgb(34, 197, 94)' :
                                       hoveredRegion.color === 'yellow' ? 'rgb(250, 204, 21)' :
                                       hoveredRegion.color === 'red' ? 'rgb(239, 68, 68)' :
                                       'rgb(59, 130, 246)',
                          backgroundColor: hoveredRegion.color === 'green' ? 'rgba(34, 197, 94, 0.2)' :
                                           hoveredRegion.color === 'yellow' ? 'rgba(250, 204, 21, 0.25)' :
                                           hoveredRegion.color === 'red' ? 'rgba(239, 68, 68, 0.2)' :
                                           'rgba(59, 130, 246, 0.15)',
                          boxShadow: '0 0 8px 2px currentColor',
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>

          {/* Right Panel - Claims List + Detail */}
          <div className="space-y-3">
            {/* Sidebar Mode Toggle */}
            <Card className="p-2">
              <Tabs value={sidebarMode} onValueChange={(v) => setSidebarMode(v as 'claims' | 'paragraphs')}>
                <TabsList className="w-full h-8">
                  <TabsTrigger value="claims" className="flex-1 h-7 text-xs">
                    <List className="h-3.5 w-3.5 mr-1" />
                    Claims ({allClaims.length})
                  </TabsTrigger>
                  <TabsTrigger value="paragraphs" className="flex-1 h-7 text-xs">
                    <FileText className="h-3.5 w-3.5 mr-1" />
                    Paragraphs ({paragraphs.filter(p => p.checked).length})
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </Card>

            {/* Claims/Paragraphs List */}
            <Card className="overflow-hidden">
              <ScrollArea className="h-[200px]">
                <div className="p-2 space-y-1">
                  {sidebarMode === 'claims' ? (
                    allClaims.map((item, idx) => {
                      const key = `${item.paragraphIndex}-${item.claimIndex}`;
                      const isModified = rewriteHistory.has(key);
                      
                      return (
                        <button
                          key={key}
                          onClick={() => selectClaim(idx)}
                          className={cn(
                            "w-full text-left p-2 rounded-md transition-colors text-xs",
                            "hover:bg-accent/50",
                            selectedClaimIndex === idx 
                              ? "bg-accent border border-primary/30" 
                              : "bg-card border border-transparent"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <div 
                              className={cn(
                                "w-2 h-2 rounded-full flex-shrink-0",
                                item.color === 'green' && "bg-green-500",
                                item.color === 'yellow' && "bg-yellow-500",
                                item.color === 'red' && "bg-red-500",
                                item.color === 'blue' && "bg-blue-500"
                              )}
                            />
                            <span className="font-mono text-muted-foreground">{item.displayId}</span>
                            <span className="truncate flex-1">{item.claim.text.slice(0, 40)}...</span>
                            {isModified && (
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 bg-orange-500/10 text-orange-600 border-orange-500/30">
                                Mod
                              </Badge>
                            )}
                          </div>
                        </button>
                      );
                    })
                  ) : (
                    paragraphs.filter(p => p.checked).map((p) => {
                      const pClaims = allClaims.filter(c => c.paragraphIndex === p.index);
                      const colors = pClaims.map(c => c.color);
                      const hasRed = colors.includes('red');
                      const hasYellow = colors.includes('yellow');
                      
                      return (
                        <button
                          key={p.index}
                          onClick={() => {
                            const firstClaim = allClaims.findIndex(c => c.paragraphIndex === p.index);
                            if (firstClaim >= 0) selectClaim(firstClaim);
                          }}
                          className={cn(
                            "w-full text-left p-2 rounded-md transition-colors text-xs",
                            "hover:bg-accent/50",
                            currentClaim?.paragraphIndex === p.index 
                              ? "bg-accent border border-primary/30" 
                              : "bg-card border border-transparent"
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <div 
                              className={cn(
                                "w-2 h-2 rounded-full flex-shrink-0",
                                hasRed ? "bg-red-500" : hasYellow ? "bg-yellow-500" : "bg-green-500"
                              )}
                            />
                            <span className="font-mono text-muted-foreground">P{p.index + 1}</span>
                            <span className="truncate flex-1">{p.text.slice(0, 40)}...</span>
                            <span className="text-muted-foreground">{pClaims.length} claims</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </ScrollArea>
            </Card>

            {/* Navigation */}
            {currentClaim && (
              <Card className="p-2">
                <div className="flex items-center justify-between">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={goToPrevClaim}
                    disabled={selectedClaimIndex === null || selectedClaimIndex === 0}
                    className="h-7 text-xs"
                  >
                    <ChevronLeft className="h-3 w-3 mr-1" />
                    Prev
                  </Button>
                  
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-muted-foreground">
                      {currentClaim.displayId}
                    </span>
                    <VerdictBadge color={currentClaim.color} />
                  </div>
                  
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={goToNextClaim}
                    disabled={selectedClaimIndex === null || selectedClaimIndex === allClaims.length - 1}
                    className="h-7 text-xs"
                  >
                    Next
                    <ChevronRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </Card>
            )}

            {/* Claim Detail */}
            {currentClaim ? (
              <ClaimCard
                claim={currentClaim.claim}
                sources={sources}
                onOpenSource={handleOpenSource}
                onImplementRewrite={handleImplementRewrite}
                showImplementButton={true}
                originalText={currentClaimHistory?.versions[0]?.text}
                onRevert={handleRevert}
                highlightColor={currentClaim.color}
                displayId={currentClaim.displayId}
              />
            ) : selectedBlueParagraph ? (
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
      ) : (
        /* Full Document View with inline highlights */
        <div className="grid gap-4 lg:grid-cols-[1fr_400px]">
          <Card className="overflow-hidden">
            <div className="p-3 border-b bg-muted/50 flex items-center justify-between">
              <h3 className="font-medium text-sm">Full Document</h3>
              <span className="text-xs text-muted-foreground">{paragraphs.length} paragraphs</span>
            </div>
            <ScrollArea className="h-[calc(100vh-280px)]">
              <div className="p-6 space-y-1 text-left">
                {paragraphs.map((p, idx) => {
                  const paragraphClaims = allClaims.filter(c => c.paragraphIndex === p.index);
                  
                  const renderTextWithHighlights = () => {
                    if (paragraphClaims.length === 0) {
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
                          title={`Claim ${c.displayId}`}
                        >
                          {c.claim.text}
                        </button>
                      );

                      lastEnd = start + c.claim.text.length;
                    });

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
                      <span className="text-xs font-mono text-muted-foreground">
                        {currentClaim.displayId}
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

                <ClaimCard
                  claim={currentClaim.claim}
                  sources={sources}
                  onOpenSource={handleOpenSource}
                  onImplementRewrite={handleImplementRewrite}
                  showImplementButton={true}
                  originalText={currentClaimHistory?.versions[0]?.text}
                  onRevert={handleRevert}
                  highlightColor={currentClaim.color}
                  displayId={currentClaim.displayId}
                />
              </>
            ) : selectedBlueParagraph ? (
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
      )}

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
