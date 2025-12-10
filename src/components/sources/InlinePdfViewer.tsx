import { useEffect, useState, useRef, useCallback } from "react";
import { Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Minimize2 } from "lucide-react";
import * as pdfjsLib from 'pdfjs-dist';
import { renderTextLayer } from 'pdfjs-dist';
import { Button } from "@/components/ui/button";
import { getFile } from "@/lib/client-storage";

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString();

interface InlinePdfViewerProps {
  filePath?: string;  // Path to file in IndexedDB
  blobUrl?: string;   // Direct blob URL 
  searchText?: string;
  onClose?: () => void;
  highlightColor?: 'green' | 'yellow' | 'red' | 'blue';
}

// Normalize PDF text extraction issues
function normalizePdfText(s: string): string {
  return s
    .replace(/ﬁ/g, 'fi')
    .replace(/ﬂ/g, 'fl')
    .replace(/ﬀ/g, 'ff')
    .replace(/ﬃ/g, 'ffi')
    .replace(/ﬄ/g, 'ffl')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, '-')
    .replace(/\u00AD/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getHighlightColorRgba(color?: 'green' | 'yellow' | 'red' | 'blue'): string {
  switch (color) {
    case 'green': return 'rgba(34, 197, 94, 0.4)';
    case 'red': return 'rgba(239, 68, 68, 0.4)';
    case 'blue': return 'rgba(59, 130, 246, 0.4)';
    case 'yellow':
    default: return 'rgba(250, 204, 21, 0.4)';
  }
}

export function InlinePdfViewer({ filePath, blobUrl, searchText, onClose, highlightColor }: InlinePdfViewerProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [highlightRects, setHighlightRects] = useState<{ x: number; y: number; width: number; height: number }[]>([]);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const highlightCanvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  // Load PDF on mount
  useEffect(() => {
    if (filePath || blobUrl) {
      loadPdf();
    }
    
    return () => {
      if (pdfDoc) {
        pdfDoc.destroy();
      }
    };
  }, [filePath, blobUrl]);

  // Re-render when page/scale/highlightColor changes
  useEffect(() => {
    if (pdfDoc) {
      renderPage(currentPage);
    }
  }, [pdfDoc, currentPage, scale, highlightColor, searchText]);

  // When searchText changes, find the page with that text
  useEffect(() => {
    if (pdfDoc && searchText) {
      findPageWithText(pdfDoc, searchText);
    }
  }, [pdfDoc, searchText]);

  const loadPdf = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      let arrayBuffer: ArrayBuffer;
      
      if (blobUrl) {
        // Load from blob URL directly
        const response = await fetch(blobUrl);
        arrayBuffer = await response.arrayBuffer();
      } else if (filePath) {
        // Load from IndexedDB
        const file = await getFile(filePath);
        if (!file) {
          setError("File not found");
          setIsLoading(false);
          return;
        }
        arrayBuffer = await file.arrayBuffer();
      } else {
        setError("No file path or blob URL provided");
        setIsLoading(false);
        return;
      }
      
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      
      // If searchText provided, search all pages to find it
      if (searchText) {
        await findPageWithText(pdf, searchText);
      }
    } catch (err) {
      console.error("Error loading PDF:", err);
      setError("Failed to load PDF");
    } finally {
      setIsLoading(false);
    }
  };

  const findPageWithText = async (pdf: pdfjsLib.PDFDocumentProxy, text: string) => {
    const normalizedSearch = normalizePdfText(text).toLowerCase().slice(0, 50);
    
    for (let i = 1; i <= pdf.numPages; i++) {
      try {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        const normalizedPage = normalizePdfText(pageText).toLowerCase();
        
        if (normalizedPage.includes(normalizedSearch)) {
          setCurrentPage(i);
          return;
        }
      } catch (err) {
        console.error(`Error searching page ${i}:`, err);
      }
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
      
      // Render text layer
      await renderPdfTextLayer(page, viewport);
      
      // Highlight search text
      if (searchText) {
        await highlightSearchText(page, viewport, searchText);
      }
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error("Error rendering page:", err);
      }
    }
  };
  
  const renderPdfTextLayer = async (page: pdfjsLib.PDFPageProxy, viewport: pdfjsLib.PageViewport) => {
    if (!textLayerRef.current) return;
    
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
  ) => {
    if (!textLayerRef.current || !text) {
      setHighlightRects([]);
      return;
    }
    
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const spans = textLayerRef.current.querySelectorAll('span');
    if (spans.length === 0) {
      setHighlightRects([]);
      return;
    }
    
    // Build full page text from spans
    const spanData: { span: HTMLSpanElement; start: number; end: number }[] = [];
    let fullText = '';
    
    spans.forEach(span => {
      const spanText = span.textContent || '';
      if (spanText.trim()) {
        const start = fullText.length;
        fullText += spanText + ' ';
        spanData.push({ span, start, end: fullText.length - 1 });
      }
    });
    
    const normalizedPage = normalizePdfText(fullText).toLowerCase();
    const normalizedSearch = normalizePdfText(text).toLowerCase().slice(0, 80);
    
    let matchStart = normalizedPage.indexOf(normalizedSearch);
    
    if (matchStart === -1 && normalizedSearch.length > 50) {
      matchStart = normalizedPage.indexOf(normalizedSearch.slice(0, 50));
    }
    
    if (matchStart === -1) {
      setHighlightRects([]);
      return;
    }
    
    const matchEnd = matchStart + normalizedSearch.length;
    
    // Find matching spans and get their rects
    const rects: { x: number; y: number; width: number; height: number }[] = [];
    const containerRect = containerRef.current?.getBoundingClientRect();
    
    for (const sd of spanData) {
      if (sd.end >= matchStart && sd.start <= matchEnd) {
        const rect = sd.span.getBoundingClientRect();
        if (containerRect) {
          rects.push({
            x: rect.left - containerRect.left,
            y: rect.top - containerRect.top,
            width: rect.width,
            height: rect.height
          });
        }
      }
    }
    
    setHighlightRects(rects);
    
    // Draw highlights
    if (highlightCanvasRef.current && rects.length > 0) {
      const ctx = highlightCanvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, highlightCanvasRef.current.width, highlightCanvasRef.current.height);
        ctx.fillStyle = getHighlightColorRgba(highlightColor);
        rects.forEach(r => {
          ctx.fillRect(r.x, r.y, r.width, r.height);
        });
      }
    }
  };

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-secondary/10 rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b bg-secondary/30">
        <span className="text-sm font-medium">Thesis Document</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScale(s => Math.max(0.5, s - 0.2))}
            className="h-7 w-7 p-0"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="text-xs w-12 text-center">{Math.round(scale * 100)}%</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScale(s => Math.min(2, s + 0.2))}
            className="h-7 w-7 p-0"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-7 w-7 p-0"
            >
              <Minimize2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      
      {/* PDF Content */}
      <div className="flex-1 overflow-auto" ref={containerRef}>
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : (
          <div className="relative inline-block">
            <canvas ref={canvasRef} className="block" />
            <canvas 
              ref={highlightCanvasRef} 
              className="absolute top-0 left-0 pointer-events-none"
            />
            <div 
              ref={textLayerRef} 
              className="absolute top-0 left-0 overflow-hidden opacity-0 pointer-events-none"
              style={{ lineHeight: 1 }}
            />
          </div>
        )}
      </div>
      
      {/* Footer - Page Navigation */}
      {totalPages > 0 && (
        <div className="flex items-center justify-center gap-2 p-2 border-t bg-secondary/30">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            className="h-7 w-7 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            className="h-7 w-7 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
