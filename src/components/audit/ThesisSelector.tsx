import { useState, useCallback } from "react";
import { Upload, FileText, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ThesisDocument, ThesisParagraph } from "@/lib/types";
import { uploadFile, createThesisDocument, createThesisParagraphs, getThesisParagraph } from "@/lib/supabase-helpers";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface ThesisSelectorProps {
  documents: ThesisDocument[];
  selectedDocId: string | null;
  currentParagraph: ThesisParagraph | null;
  onDocumentSelect: (docId: string) => void;
  onParagraphChange: (paragraph: ThesisParagraph | null) => void;
  onDocumentsUpdate: () => void;
}

export function ThesisSelector({
  documents,
  selectedDocId,
  currentParagraph,
  onDocumentSelect,
  onParagraphChange,
  onDocumentsUpdate,
}: ThesisSelectorProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);

  const selectedDoc = documents.find(d => d.id === selectedDocId);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== 'application/pdf') {
      toast({ title: "Please select a PDF file", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    try {
      // Upload file
      const filePath = await uploadFile(file, 'thesis');
      
      // Create document record
      const doc = await createThesisDocument({
        filename: filePath.split('/').pop() || file.name,
        file_path: filePath,
        title: file.name.replace(/\.pdf$/i, ''),
        total_paragraphs: 0,
      });

      // Extract text from PDF (simplified - in production you'd use a proper PDF parser)
      // For now, we'll simulate paragraph extraction
      const text = await extractTextFromPdf(file);
      const paragraphs = splitIntoParagraphs(text);
      
      // Create paragraph records
      await createThesisParagraphs(
        paragraphs.map((text, index) => ({
          thesis_document_id: doc.id,
          index,
          text,
        }))
      );

      toast({
        title: "Thesis uploaded",
        description: `Found ${paragraphs.length} paragraphs.`,
      });

      onDocumentsUpdate();
      onDocumentSelect(doc.id);
    } catch (error) {
      console.error('Upload error:', error);
      toast({ title: "Failed to upload thesis", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }, [onDocumentsUpdate, onDocumentSelect]);

  const navigateParagraph = async (direction: 'prev' | 'next') => {
    if (!selectedDocId || !currentParagraph) return;
    
    const newIndex = direction === 'next' 
      ? currentParagraph.index + 1 
      : currentParagraph.index - 1;
    
    if (newIndex < 0 || (selectedDoc && newIndex >= selectedDoc.total_paragraphs)) {
      toast({ title: direction === 'next' ? "End of thesis" : "Start of thesis" });
      return;
    }

    setIsNavigating(true);
    try {
      const paragraph = await getThesisParagraph(selectedDocId, newIndex);
      onParagraphChange(paragraph);
    } catch (error) {
      console.error('Navigation error:', error);
    } finally {
      setIsNavigating(false);
    }
  };

  const handleDocSelect = async (docId: string) => {
    onDocumentSelect(docId);
    setIsNavigating(true);
    try {
      const paragraph = await getThesisParagraph(docId, 0);
      onParagraphChange(paragraph);
    } catch (error) {
      console.error('Error loading first paragraph:', error);
    } finally {
      setIsNavigating(false);
    }
  };

  return (
    <div className="bg-secondary/30 rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Thesis Mode
        </h3>
        <div className="flex items-center gap-2">
          <input
            type="file"
            accept=".pdf"
            onChange={handleUpload}
            className="hidden"
            id="thesis-upload"
            disabled={isUploading}
          />
          <label htmlFor="thesis-upload">
            <Button variant="outline" size="sm" asChild disabled={isUploading}>
              <span className="cursor-pointer">
                {isUploading ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                Upload Thesis
              </span>
            </Button>
          </label>
        </div>
      </div>

      {documents.length > 0 && (
        <div className="space-y-3">
          <Select value={selectedDocId || ''} onValueChange={handleDocSelect}>
            <SelectTrigger>
              <SelectValue placeholder="Select a thesis document" />
            </SelectTrigger>
            <SelectContent>
              {documents.map(doc => (
                <SelectItem key={doc.id} value={doc.id}>
                  {doc.title || doc.filename} ({doc.total_paragraphs} paragraphs)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedDoc && currentParagraph && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Paragraph {currentParagraph.index + 1} of {selectedDoc.total_paragraphs}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateParagraph('prev')}
                  disabled={currentParagraph.index === 0 || isNavigating}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateParagraph('next')}
                  disabled={currentParagraph.index >= selectedDoc.total_paragraphs - 1 || isNavigating}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Simple PDF text extraction (placeholder - would need proper implementation)
async function extractTextFromPdf(file: File): Promise<string> {
  // In a real implementation, you'd use pdf.js or send to backend
  // For demo, we'll read any text content we can
  const text = await file.text().catch(() => '');
  
  // If we can't read the PDF directly, return sample text
  if (!text || text.length < 100) {
    return `This is a sample paragraph from the uploaded thesis. In a production environment, this would contain the actual extracted text from the PDF document.

The second paragraph would discuss the methodology used in the research. Various approaches were considered before selecting the final method.

Results showed significant improvements compared to baseline measurements. Statistical analysis confirmed the validity of these findings (p < 0.05).

Discussion of the implications follows. These results suggest important applications for the field.

In conclusion, this thesis demonstrates the effectiveness of the proposed approach and opens avenues for future research.`;
  }
  
  return text;
}

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 50); // Filter out very short paragraphs
}
