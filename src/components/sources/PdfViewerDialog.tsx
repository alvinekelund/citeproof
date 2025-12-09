import { useEffect, useState } from "react";
import { X, Download, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { getFile } from "@/lib/client-storage";

interface PdfViewerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string | null;
  fileName: string;
}

export function PdfViewerDialog({ open, onOpenChange, filePath, fileName }: PdfViewerDialogProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && filePath) {
      loadPdf();
    } else {
      // Clean up URL when dialog closes
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
    }
    
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [open, filePath]);

  const loadPdf = async () => {
    if (!filePath) return;
    
    setIsLoading(true);
    setError(null);
    
    try {
      const file = await getFile(filePath);
      if (file) {
        const url = URL.createObjectURL(file);
        setPdfUrl(url);
      } else {
        setError("File not found. It may have been deleted.");
      }
    } catch (err) {
      console.error("Error loading PDF:", err);
      setError("Failed to load PDF file.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDownload = () => {
    if (pdfUrl) {
      const a = document.createElement('a');
      a.href = pdfUrl;
      a.download = fileName;
      a.click();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 py-4 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold truncate pr-4">
              {fileName}
            </DialogTitle>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleDownload} disabled={!pdfUrl}>
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-hidden bg-muted/30">
          {isLoading && (
            <div className="h-full flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="ml-2 text-muted-foreground">Loading PDF...</span>
            </div>
          )}
          
          {error && (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <p className="text-destructive font-medium">{error}</p>
                <Button variant="outline" className="mt-4" onClick={loadPdf}>
                  Try Again
                </Button>
              </div>
            </div>
          )}
          
          {pdfUrl && !isLoading && !error && (
            <iframe
              src={pdfUrl}
              className="w-full h-full border-0"
              title={fileName}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}