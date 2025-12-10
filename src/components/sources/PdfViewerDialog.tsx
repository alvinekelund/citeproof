import { useEffect, useState, useRef, useCallback } from "react";
import { Download, Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, AlertCircle, Search, X } from "lucide-react";
import * as pdfjsLib from 'pdfjs-dist';
import { renderTextLayer } from 'pdfjs-dist';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getFile } from "@/lib/client-storage";
import { toast } from "@/hooks/use-toast";

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface PdfViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string | null;
  fileName: string;
  initialPage?: number;
  searchText?: string;
  highlightColor?: 'green' | 'yellow' | 'red' | 'blue'; // Color for highlighting
}

// Normalize PDF text extraction issues - handles ligatures, encoding, OCR quirks
function normalizePdfText(s: string): string {
  return s
    // Ligatures
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬄ/g, 'ffl')
    // Smart quotes and apostrophes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    // Dashes and hyphens
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
    // Soft hyphen (invisible)
    .replace(/\u00AD/g, '')
    // Non-breaking space
    .replace(/\u00A0/g, ' ')
    // Multiple spaces/whitespace to single space
    .replace(/\s+/g, ' ')
    // Common OCR errors
    .replace(/[ﬆ]/g, 'st')
    .trim();
}

// Levenshtein distance for fuzzy matching
function levenshtein(a: string, b: string): number {
  if (a.length > 200 || b.length > 200) {
    // For long strings, use a simplified approach
    return Math.abs(a.length - b.length);
  }
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i - 1] === a[j - 1]
        ? matrix[i - 1][j - 1]
        : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

// Get n-grams (overlapping word sequences) for matching - filter out common words
const STOP_WORDS = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'were', 'they', 'this', 'that', 'with', 'from', 'will', 'would', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like', 'time', 'just', 'know', 'take', 'into', 'year', 'your', 'some', 'them', 'than', 'then', 'look', 'only', 'come', 'over', 'such', 'also', 'back', 'after', 'use', 'two', 'how', 'way', 'could', 'people', 'other', 'more', 'these', 'being', 'new']);

function getDistinctiveWords(text: string, minLength: number = 5): string[] {
  return text
    .split(/\s+/)
    .filter(w => w.length >= minLength && !STOP_WORDS.has(w.toLowerCase()));
}

// Fuzzy match with tolerance - STRICT matching to avoid false positives
function fuzzyMatch(text: string, search: string, tolerance = 0.15): { start: number; end: number; confidence: number } | null {
  // Apply PDF-specific normalization
  const normalizedText = normalizePdfText(text).toLowerCase();
  const normalizedSearch = normalizePdfText(search).toLowerCase();
  
  // For very short searches, require exact match
  if (normalizedSearch.length < 15) {
    const idx = normalizedText.indexOf(normalizedSearch);
    if (idx !== -1) return { start: idx, end: idx + normalizedSearch.length, confidence: 1.0 };
    return null;
  }
  
  // Strategy 1: Try exact match first (highest confidence)
  const exactIdx = normalizedText.indexOf(normalizedSearch);
  if (exactIdx !== -1) {
    return { start: exactIdx, end: exactIdx + normalizedSearch.length, confidence: 1.0 };
  }
  
  // Strategy 2: Try matching long prefixes ONLY (at least 50 chars for reliability)
  for (const prefixLen of [100, 80, 60, 50]) {
    if (normalizedSearch.length >= prefixLen) {
      const prefix = normalizedSearch.slice(0, prefixLen);
      const prefixIdx = normalizedText.indexOf(prefix);
      if (prefixIdx !== -1) {
        return { 
          start: prefixIdx, 
          end: Math.min(prefixIdx + normalizedSearch.length, normalizedText.length),
          confidence: 0.95 
        };
      }
    }
  }
  
  // Strategy 3: Find distinctive words (long, uncommon) - require MULTIPLE matches
  const distinctiveSearchWords = getDistinctiveWords(normalizedSearch, 6);
  
  if (distinctiveSearchWords.length >= 3) {
    // Find the first distinctive word
    for (const word of distinctiveSearchWords.slice(0, 3)) {
      const wordIdx = normalizedText.indexOf(word);
      if (wordIdx !== -1) {
        // Check if MULTIPLE other distinctive words are nearby (within 300 chars)
        const context = normalizedText.slice(Math.max(0, wordIdx - 100), wordIdx + 300);
        let matchCount = 0;
        const matchedWords: string[] = [];
        
        for (const sw of distinctiveSearchWords) {
          if (context.includes(sw)) {
            matchCount++;
            matchedWords.push(sw);
          }
        }
        
        // Require at least 60% of distinctive words to match (minimum 3)
        const requiredMatches = Math.max(3, Math.ceil(distinctiveSearchWords.length * 0.6));
        if (matchCount >= requiredMatches) {
          return { 
            start: Math.max(0, wordIdx - 50), 
            end: Math.min(wordIdx + normalizedSearch.length, normalizedText.length),
            confidence: 0.8 
          };
        }
      }
    }
  }
  
  // Strategy 4: Sliding window Levenshtein ONLY for short-medium searches (expensive)
  if (normalizedSearch.length >= 30 && normalizedSearch.length <= 100) {
    const searchLen = normalizedSearch.length;
    const maxDist = Math.floor(searchLen * 0.1); // Very strict: only 10% tolerance
    
    // Sample every 20 characters for efficiency
    for (let i = 0; i <= normalizedText.length - searchLen; i += 20) {
      const window = normalizedText.slice(i, i + searchLen);
      const dist = levenshtein(window, normalizedSearch);
      if (dist <= maxDist) {
        return { start: i, end: i + searchLen, confidence: 0.7 };
      }
    }
  }
  
  // No match found - be conservative and return null
  return null;
}

// Get highlight color based on verdict
function getHighlightColorRgba(color?: 'green' | 'yellow' | 'red' | 'blue'): string {
  switch (color) {
    case 'green': return 'rgba(34, 197, 94, 0.4)';
    case 'red': return 'rgba(239, 68, 68, 0.4)';
    case 'blue': return 'rgba(59, 130, 246, 0.4)';
    case 'yellow':
    default: return 'rgba(250, 204, 21, 0.4)';
  }
}

export function PdfViewerDialog({ open, onOpenChange, filePath, fileName, initialPage = 1, searchText, highlightColor }: PdfViewerDialogProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageInputValue, setPageInputValue] = useState(String(initialPage));
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [highlightRects, setHighlightRects] = useState<{ x: number; y: number; width: number; height: number }[]>([]);
  const [highlightNotFound, setHighlightNotFound] = useState(false);
  const [isSearchingAllPages, setIsSearchingAllPages] = useState(false);
  const [searchProgress, setSearchProgress] = useState(0);
  const [foundPages, setFoundPages] = useState<number[]>([]);
  const [currentFoundIndex, setCurrentFoundIndex] = useState(0);
  
  // Search bar state
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchBar, setShowSearchBar] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const highlightCanvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);
  const autoSearchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasAutoSearchedRef = useRef(false);

  // Load PDF document
  useEffect(() => {
    if (open && filePath) {
      loadPdf();
      hasAutoSearchedRef.current = false;
    }
    
    return () => {
      if (pdfDoc) {
        pdfDoc.destroy();
        setPdfDoc(null);
      }
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
      }
      if (autoSearchTimeoutRef.current) {
        clearTimeout(autoSearchTimeoutRef.current);
      }
    };
  }, [open, filePath]);

  // Set initial page and reset state when dialog opens
  useEffect(() => {
    if (open) {
      if (initialPage && initialPage !== currentPage) {
        setCurrentPage(initialPage);
        setPageInputValue(String(initialPage));
      }
      setHighlightNotFound(false);
      setFoundPages([]);
      setCurrentFoundIndex(0);
      // Pre-fill search bar with excerpt
      if (searchText) {
        setSearchQuery(searchText.slice(0, 100));
        setShowSearchBar(true);
      }
    }
  }, [open, initialPage, searchText]);

  // Render page when page number or scale changes
  useEffect(() => {
    if (pdfDoc) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage, scale, highlightColor]);

  const loadPdf = async () => {
    if (!filePath) return;
    
    setIsLoading(true);
    setError(null);
    const startPage = initialPage || 1;
    setCurrentPage(startPage);
    setPageInputValue(String(startPage));
    
    try {
      const file = await getFile(filePath);
      if (!file) {
        setError("File not found. It may have been deleted.");
        return;
      }
      
      const arrayBuffer = await file.arrayBuffer();
      const url = URL.createObjectURL(file);
      setBlobUrl(url);
      
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
    } catch (err) {
      console.error("Error loading PDF:", err);
      setError("Failed to load PDF file.");
    } finally {
      setIsLoading(false);
    }
  };

  const renderPage = async (pageNum: number) => {
    if (!pdfDoc || !canvasRef.current) return;
    
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }
    
    try {
      const page = await pdfDoc.getPage(pageNum);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      if (!context) return;
      
      const viewport = page.getViewport({ scale });
      
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      if (highlightCanvasRef.current) {
        highlightCanvasRef.current.height = viewport.height;
        highlightCanvasRef.current.width = viewport.width;
      }
      
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };
      
      renderTaskRef.current = page.render(renderContext);
      await renderTaskRef.current.promise;
      
      // Render text layer for Ctrl+F support
      await renderPdfTextLayer(page, viewport);
      
      // Highlight search text
      if (searchText) {
        const found = await highlightSearchText(page, viewport, searchText);
        
        // Auto-search all pages if not found on initial page
        if (!found && !hasAutoSearchedRef.current && pageNum === initialPage) {
          hasAutoSearchedRef.current = true;
          autoSearchTimeoutRef.current = setTimeout(() => {
            searchAllPages(searchText);
          }, 300);
        }
      } else {
        setHighlightRects([]);
      }
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error("Error rendering page:", err);
      }
    }
  };
  
  const renderPdfTextLayer = async (page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport) => {
    if (!textLayerRef.current) return;
    
    // Clear existing text layer
    textLayerRef.current.innerHTML = '';
    textLayerRef.current.style.width = `${viewport.width}px`;
    textLayerRef.current.style.height = `${viewport.height}px`;
    
    try {
      const textContent = await page.getTextContent();
      
      const task = renderTextLayer({
        textContentSource: textContent,
        container: textLayerRef.current,
        viewport: viewport,
      });
      
      await task.promise;
    } catch (err) {
      console.error('Error rendering text layer:', err);
    }
  };
  
  const highlightSearchText = async (
    page: pdfjsLib.PDFPageProxy, 
    viewport: pdfjsLib.PageViewport,
    text: string
  ): Promise<boolean> => {
    try {
      const textContent = await page.getTextContent();
      const textItems = textContent.items as Array<{
        str: string;
        transform: number[];
        width: number;
        height: number;
      }>;
      
      if (!text || textItems.length === 0) {
        setHighlightRects([]);
        return false;
      }
      
      // Build page text with position tracking
      const pageText: { char: string; itemIdx: number; charIdx: number }[] = [];
      for (let itemIdx = 0; itemIdx < textItems.length; itemIdx++) {
        const item = textItems[itemIdx];
        for (let charIdx = 0; charIdx < item.str.length; charIdx++) {
          pageText.push({ char: item.str[charIdx], itemIdx, charIdx });
        }
        pageText.push({ char: ' ', itemIdx, charIdx: item.str.length });
      }
      
      const fullText = pageText.map(p => p.char).join('');
      
      // Use fuzzy matching
      const match = fuzzyMatch(fullText, text);
      
      if (!match) {
        setHighlightRects([]);
        setHighlightNotFound(true);
        return false;
      }
      
      setHighlightNotFound(false);
      
      // Map match positions to text items using normalized text
      const normalizedFull = normalizePdfText(fullText).toLowerCase();
      
      // Find character positions in original text
      let normalizedPos = 0;
      const charToOriginal: number[] = [];
      
      for (let i = 0; i < fullText.length; i++) {
        const char = fullText[i];
        const normalizedChar = normalizePdfText(char).toLowerCase();
        if (normalizedChar.length > 0) {
          charToOriginal[normalizedPos] = i;
          normalizedPos++;
        }
      }
      
      const origStart = charToOriginal[match.start] ?? 0;
      const origEnd = charToOriginal[Math.min(match.end, charToOriginal.length - 1)] ?? fullText.length;
      
      // Get item indices for the match
      const startItemIdx = pageText[origStart]?.itemIdx ?? 0;
      const endItemIdx = pageText[Math.min(origEnd, pageText.length - 1)]?.itemIdx ?? textItems.length - 1;
      
      // Collect rects
      const rects: { x: number; y: number; width: number; height: number }[] = [];
      
      for (let idx = startItemIdx; idx <= endItemIdx && idx < textItems.length; idx++) {
        const item = textItems[idx];
        if (!item.str.trim()) continue;
        
        const [a, b, c, d, tx, ty] = item.transform;
        const x = tx * viewport.scale;
        const y = viewport.height - (ty * viewport.scale);
        const width = item.width * viewport.scale;
        const height = Math.abs(d) * viewport.scale * 1.2;
        
        rects.push({ x, y: y - height, width, height });
      }
      
      setHighlightRects(rects);
      
      // Draw highlights with the specified color
      if (highlightCanvasRef.current && rects.length > 0) {
        const ctx = highlightCanvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, highlightCanvasRef.current.width, highlightCanvasRef.current.height);
          ctx.fillStyle = getHighlightColorRgba(highlightColor);
          for (const rect of rects) {
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
          }
        }
        
        // Scroll to highlight
        if (rects.length > 0 && containerRef.current) {
          const firstRect = rects[0];
          const scrollTop = Math.max(0, firstRect.y - 100);
          setTimeout(() => {
            containerRef.current?.scrollTo({ top: scrollTop, behavior: 'smooth' });
          }, 100);
        }
      }
      
      return true;
    } catch (err) {
      console.error('Error highlighting text:', err);
      setHighlightRects([]);
      return false;
    }
  };

  const searchAllPages = async (text?: string) => {
    if (!pdfDoc) return;
    
    const searchFor = text || searchQuery;
    if (!searchFor) return;
    
    setIsSearchingAllPages(true);
    setSearchProgress(0);
    setFoundPages([]);
    
    const found: number[] = [];
    
    try {
      for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        setSearchProgress(Math.round((pageNum / totalPages) * 100));
        
        const page = await pdfDoc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const textItems = textContent.items as Array<{ str: string }>;
        
        const pageText = textItems.map(item => item.str).join(' ');
        const match = fuzzyMatch(pageText, searchFor);
        
        if (match) {
          found.push(pageNum);
        }
      }
      
      setFoundPages(found);
      setIsSearchingAllPages(false);
      
      if (found.length > 0) {
        setCurrentFoundIndex(0);
        goToPage(found[0]);
        toast({
          title: `Found on ${found.length} page${found.length > 1 ? 's' : ''}`,
          description: found.length > 1 ? `Pages: ${found.slice(0, 5).join(', ')}${found.length > 5 ? '...' : ''}` : undefined,
        });
      } else {
        toast({
          title: "Not found",
          description: "Text not found in this document",
          variant: "destructive",
        });
      }
    } catch (err) {
      console.error('Error searching all pages:', err);
      setIsSearchingAllPages(false);
      toast({
        title: "Search failed",
        description: "An error occurred while searching",
        variant: "destructive",
      });
    }
  };
  
  const goToNextFound = () => {
    if (foundPages.length === 0) return;
    const nextIndex = (currentFoundIndex + 1) % foundPages.length;
    setCurrentFoundIndex(nextIndex);
    goToPage(foundPages[nextIndex]);
  };
  
  const goToPrevFound = () => {
    if (foundPages.length === 0) return;
    const prevIndex = (currentFoundIndex - 1 + foundPages.length) % foundPages.length;
    setCurrentFoundIndex(prevIndex);
    goToPage(foundPages[prevIndex]);
  };

  const goToPage = useCallback((page: number) => {
    const validPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(validPage);
    setPageInputValue(String(validPage));
  }, [totalPages]);

  const handlePageInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPageInputValue(e.target.value);
  };

  const handlePageInputSubmit = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const page = parseInt(pageInputValue, 10);
      if (!isNaN(page)) {
        goToPage(page);
      }
    }
  };

  const handlePageInputBlur = () => {
    const page = parseInt(pageInputValue, 10);
    if (!isNaN(page)) {
      goToPage(page);
    } else {
      setPageInputValue(String(currentPage));
    }
  };
  
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      searchAllPages();
    } else if (e.key === 'Escape') {
      setShowSearchBar(false);
    }
  };

  const zoomIn = () => setScale(s => Math.min(s + 0.25, 3));
  const zoomOut = () => setScale(s => Math.max(s - 0.25, 0.5));
  const resetZoom = () => setScale(1.2);

  const handleDownload = () => {
    if (blobUrl) {
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = fileName;
      a.click();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between gap-4">
            <DialogTitle className="text-base font-semibold truncate flex-1">
              {fileName}
            </DialogTitle>
            
            {/* Page Navigation */}
            <div className="flex items-center gap-1">
              <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => goToPage(currentPage - 1)}
                disabled={currentPage <= 1 || !pdfDoc}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              
              <div className="flex items-center gap-1 text-sm">
                <Input
                  value={pageInputValue}
                  onChange={handlePageInput}
                  onKeyDown={handlePageInputSubmit}
                  onBlur={handlePageInputBlur}
                  className="w-12 h-8 text-center px-1"
                  disabled={!pdfDoc}
                />
                <span className="text-muted-foreground">/ {totalPages}</span>
              </div>
              
              <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8"
                onClick={() => goToPage(currentPage + 1)}
                disabled={currentPage >= totalPages || !pdfDoc}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Zoom Controls */}
            <div className="flex items-center gap-1">
              <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8"
                onClick={zoomOut}
                disabled={scale <= 0.5 || !pdfDoc}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              
              <span className="text-sm w-14 text-center text-muted-foreground">
                {Math.round(scale * 100)}%
              </span>
              
              <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8"
                onClick={zoomIn}
                disabled={scale >= 3 || !pdfDoc}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              
              <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8"
                onClick={resetZoom}
                disabled={!pdfDoc}
                title="Reset zoom"
              >
                <RotateCw className="h-4 w-4" />
              </Button>
            </div>
            
            {/* Search Toggle */}
            <Button 
              variant={showSearchBar ? "default" : "outline"} 
              size="icon" 
              className="h-8 w-8"
              onClick={() => setShowSearchBar(!showSearchBar)}
              disabled={!pdfDoc}
            >
              <Search className="h-4 w-4" />
            </Button>
            
            {/* Download */}
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={!blobUrl}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
          
          {/* Search Bar */}
          {showSearchBar && (
            <div className="flex items-center gap-2 mt-3 pt-3 border-t">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search in document... (Enter to search all pages)"
                  className="pl-8 pr-8 h-9"
                  autoFocus
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                    onClick={() => setSearchQuery('')}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => searchAllPages()}
                disabled={!searchQuery || isSearchingAllPages}
              >
                {isSearchingAllPages ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    {searchProgress}%
                  </>
                ) : (
                  'Search All'
                )}
              </Button>
              
              {foundPages.length > 0 && (
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToPrevFound}>
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground whitespace-nowrap">
                    {currentFoundIndex + 1} / {foundPages.length}
                  </span>
                  <Button variant="outline" size="icon" className="h-8 w-8" onClick={goToNextFound}>
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogHeader>
        
        <div 
          ref={containerRef}
          className="flex-1 overflow-auto bg-muted/50 flex justify-center p-4"
        >
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Loading PDF...</span>
            </div>
          )}
          
          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-destructive font-medium">{error}</p>
                <Button variant="outline" className="mt-4" onClick={loadPdf}>
                  Try Again
                </Button>
              </div>
            </div>
          )}
          
          {!isLoading && !error && (
            <div className="relative">
              <canvas 
                ref={canvasRef} 
                className="shadow-lg bg-background"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
              {/* Text layer for Ctrl+F support */}
              <div 
                ref={textLayerRef}
                className="absolute top-0 left-0 text-layer"
                style={{ 
                  maxWidth: '100%',
                  lineHeight: '1.0',
                }}
              />
              <canvas 
                ref={highlightCanvasRef}
                className="absolute top-0 left-0 pointer-events-none"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
              
              {/* Not found indicator */}
              {searchText && highlightNotFound && highlightRects.length === 0 && !isSearchingAllPages && foundPages.length === 0 && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-100 dark:bg-amber-900/50 border border-amber-300 dark:border-amber-700 rounded-lg px-4 py-2 flex items-center gap-2 shadow-lg z-10">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm text-amber-800 dark:text-amber-200">
                    Searching document...
                  </span>
                  <Loader2 className="h-4 w-4 animate-spin text-amber-600" />
                </div>
              )}
              
              {/* Found pages indicator */}
              {foundPages.length > 0 && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-verdict-green-bg border border-verdict-green/30 rounded-lg px-4 py-2 flex items-center gap-2 shadow-lg z-10">
                  <span className="text-sm text-verdict-green">
                    Found on {foundPages.length} page{foundPages.length > 1 ? 's' : ''}
                    {foundPages.length > 1 && `: ${foundPages.slice(0, 3).join(', ')}${foundPages.length > 3 ? '...' : ''}`}
                  </span>
                </div>
              )}
              
              {/* Searching all pages indicator */}
              {isSearchingAllPages && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-primary/10 border border-primary/30 rounded-lg px-4 py-2 flex items-center gap-2 shadow-lg z-10">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span className="text-sm text-foreground">
                    Searching all pages... {searchProgress}%
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
