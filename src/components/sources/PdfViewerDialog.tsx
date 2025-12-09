import { useEffect, useState, useRef, useCallback } from "react";
import { Download, Loader2, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw } from "lucide-react";
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
}

export function PdfViewerDialog({ open, onOpenChange, filePath, fileName, initialPage = 1 }: PdfViewerDialogProps) {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.2);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageInputValue, setPageInputValue] = useState(String(initialPage));
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  // Set initial page when initialPage prop changes
  useEffect(() => {
    if (open && initialPage && initialPage !== currentPage) {
      setCurrentPage(initialPage);
      setPageInputValue(String(initialPage));
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
      
      const renderContext = {
        canvasContext: context,
        viewport: viewport,
      };
      
      renderTaskRef.current = page.render(renderContext);
      await renderTaskRef.current.promise;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error("Error rendering page:", err);
      }
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
            <canvas 
              ref={canvasRef} 
              className="shadow-lg bg-background"
              style={{ maxWidth: '100%', height: 'auto' }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}