import { useEffect, useState, useRef, useCallback } from "react";
import { Download, Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, AlertCircle } from "lucide-react";
import * as pdfjsLib from 'pdfjs-dist';
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
  searchText?: string; // Text excerpt to highlight
}

export function PdfViewerDialog({ open, onOpenChange, filePath, fileName, initialPage = 1, searchText }: PdfViewerDialogProps) {
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
  const [searchedPages, setSearchedPages] = useState<Set<number>>(new Set());
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const highlightCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  // Load PDF document
  useEffect(() => {
    if (open && filePath) {
      loadPdf();
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
    };
  }, [open, filePath]);

  // Set initial page and reset highlight state when dialog opens
  useEffect(() => {
    if (open) {
      if (initialPage && initialPage !== currentPage) {
        setCurrentPage(initialPage);
        setPageInputValue(String(initialPage));
      }
      // Reset highlight state when opening
      setHighlightNotFound(false);
      setSearchedPages(new Set());
    }
  }, [open, initialPage]);

  // Render page when page number or scale changes
  useEffect(() => {
    if (pdfDoc) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage, scale]);

  const loadPdf = async () => {
    if (!filePath) return;
    
    setIsLoading(true);
    setError(null);
    // Use initialPage or default to 1
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
    
    // Cancel any ongoing render
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }
    
    try {
      const page = await pdfDoc.getPage(pageNum);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d');
      
      if (!context) return;
      
      const viewport = page.getViewport({ scale });
      
      // Set canvas dimensions
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      // Also set highlight canvas dimensions
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
      
      // After rendering, search for text to highlight
      if (searchText) {
        await highlightSearchText(page, viewport);
      } else {
        setHighlightRects([]);
      }
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error("Error rendering page:", err);
      }
    }
  };
  
  const highlightSearchText = async (page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport) => {
    try {
      const textContent = await page.getTextContent();
      const textItems = textContent.items as Array<{
        str: string;
        transform: number[];
        width: number;
        height: number;
      }>;
      
      if (!searchText || textItems.length === 0) {
        setHighlightRects([]);
        return;
      }
      
      // Build concatenated page text with position tracking
      const pageText: { char: string; itemIdx: number; charIdx: number }[] = [];
      for (let itemIdx = 0; itemIdx < textItems.length; itemIdx++) {
        const item = textItems[itemIdx];
        for (let charIdx = 0; charIdx < item.str.length; charIdx++) {
          pageText.push({ char: item.str[charIdx], itemIdx, charIdx });
        }
        pageText.push({ char: ' ', itemIdx, charIdx: item.str.length });
      }
      
      const fullText = pageText.map(p => p.char).join('');
      
      // Normalize for matching
      const normalize = (s: string) => s.toLowerCase().replace(/[\s\-–—]+/g, ' ').replace(/[^\w\s]/g, '').trim();
      const normalizedSearch = normalize(searchText);
      const normalizedFull = normalize(fullText);
      
      let bestMatchStart = -1;
      let bestMatchLength = 0;
      let bestScore = 0;
      
      // Method 1: Word-based fuzzy matching with lower threshold
      const searchWords = normalizedSearch.split(/\s+/).filter(w => w.length > 2);
      const windowSize = Math.min(normalizedSearch.length + 100, normalizedFull.length);
      const minConsecutive = Math.max(1, Math.floor(searchWords.length / 3)); // Lower threshold
      
      for (let start = 0; start <= normalizedFull.length - 20; start++) {
        const window = normalizedFull.substring(start, start + windowSize);
        let score = 0;
        let consecutiveMatches = 0;
        
        for (const word of searchWords) {
          const idx = window.indexOf(word);
          if (idx !== -1 && idx < normalizedSearch.length * 2) {
            score += word.length;
            if (idx < 150) consecutiveMatches++;
          }
        }
        
        score += consecutiveMatches * 10;
        
        if (score > bestScore && consecutiveMatches >= minConsecutive) {
          bestScore = score;
          bestMatchStart = start;
          bestMatchLength = Math.min(normalizedSearch.length + 50, windowSize);
        }
      }
      
      // Method 2: Fallback to direct substring search if fuzzy matching fails
      if (bestMatchStart === -1) {
        // Try finding first 30 chars of search text
        const shortSearch = normalizedSearch.slice(0, 50);
        const directIdx = normalizedFull.indexOf(shortSearch);
        if (directIdx !== -1) {
          bestMatchStart = directIdx;
          bestMatchLength = Math.min(normalizedSearch.length + 20, normalizedFull.length - directIdx);
          console.log('[highlight] Found via direct substring match at', directIdx);
        }
      }
      
      // Method 3: Try matching just the first few words
      if (bestMatchStart === -1 && searchWords.length > 0) {
        const firstWords = searchWords.slice(0, 3).join(' ');
        const idx = normalizedFull.indexOf(firstWords);
        if (idx !== -1) {
          bestMatchStart = idx;
          bestMatchLength = Math.min(normalizedSearch.length, normalizedFull.length - idx);
          console.log('[highlight] Found via first-words match at', idx);
        }
      }
      
      if (bestMatchStart === -1) {
        console.log('[highlight] Excerpt not found on page', currentPage);
        setHighlightRects([]);
        setSearchedPages(prev => new Set(prev).add(currentPage));
        
        // Show "not found" indicator after searching initial page
        if (!searchedPages.has(currentPage)) {
          setHighlightNotFound(true);
        }
        return;
      }
      
      // Found! Clear the not found indicator
      setHighlightNotFound(false);
      
      // Map normalized positions back to original text
      let normalizedPos = 0;
      let startItemIdx = -1;
      let endItemIdx = -1;
      let charCount = 0;
      
      for (let i = 0; i < fullText.length; i++) {
        const char = fullText[i];
        const isWordChar = /\w/.test(char);
        const isSpace = /\s/.test(char);
        
        if (isWordChar) {
          if (charCount === bestMatchStart && startItemIdx === -1) {
            startItemIdx = pageText[i]?.itemIdx ?? -1;
          }
          if (charCount >= bestMatchStart && charCount < bestMatchStart + bestMatchLength) {
            endItemIdx = pageText[i]?.itemIdx ?? endItemIdx;
          }
          charCount++;
        } else if (isSpace && charCount > 0) {
          charCount++;
        }
      }
      
      if (startItemIdx === -1) {
        setHighlightRects([]);
        return;
      }
      
      // Collect rects for matched items
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
      
      // Draw highlights
      if (highlightCanvasRef.current && rects.length > 0) {
        const ctx = highlightCanvasRef.current.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, highlightCanvasRef.current.width, highlightCanvasRef.current.height);
          ctx.fillStyle = 'rgba(250, 204, 21, 0.35)';
          for (const rect of rects) {
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
          }
        }
        
        // Scroll to first highlight
        if (rects.length > 0 && containerRef.current) {
          const firstRect = rects[0];
          const scrollTop = Math.max(0, firstRect.y - 100);
          setTimeout(() => {
            containerRef.current?.scrollTo({ top: scrollTop, behavior: 'smooth' });
          }, 100);
        }
      }
    } catch (err) {
      console.error('Error highlighting text:', err);
      setHighlightRects([]);
    }
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
            
            {/* Download */}
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={!blobUrl}>
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>
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
              <canvas 
                ref={highlightCanvasRef}
                className="absolute top-0 left-0 pointer-events-none"
                style={{ maxWidth: '100%', height: 'auto' }}
              />
              
              {/* Not found indicator */}
              {searchText && highlightNotFound && highlightRects.length === 0 && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-amber-100 dark:bg-amber-900/50 border border-amber-300 dark:border-amber-700 rounded-lg px-4 py-2 flex items-center gap-2 shadow-lg z-10">
                  <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm text-amber-800 dark:text-amber-200">
                    Excerpt not found on this page
                  </span>
                  <div className="flex gap-1 ml-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => goToPage(currentPage - 1)}
                      disabled={currentPage <= 1}
                    >
                      Try prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 text-xs"
                      onClick={() => goToPage(currentPage + 1)}
                      disabled={currentPage >= totalPages}
                    >
                      Try next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}