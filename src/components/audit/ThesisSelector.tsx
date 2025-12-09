import { useState, useCallback } from "react";
import { Upload, FileText, ChevronLeft, ChevronRight, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { ThesisDocument, ThesisParagraph } from "@/lib/types";
import { uploadFile, createThesisDocument, createThesisParagraphs, getThesisParagraph } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

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
  const [uploadStatus, setUploadStatus] = useState<string>('');
  const [parseError, setParseError] = useState<string | null>(null);

  const selectedDoc = documents.find(d => d.id === selectedDocId);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    const validExts = ['.pdf', '.docx', '.txt'];
    const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
    
    if (!validTypes.includes(file.type) && !validExts.includes(ext)) {
      toast({ title: "Please select a PDF, DOCX, or TXT file", variant: "destructive" });
      return;
    }

    setIsUploading(true);
    setParseError(null);
    setUploadStatus('Uploading file...');
    
    try {
      // Upload file
      const filePath = await uploadFile(file, 'thesis');
      setUploadStatus('File uploaded, parsing PDF...');
      
      // Create document record first
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      const doc = await createThesisDocument({
        filename: filePath.split('/').pop() || file.name,
        file_path: filePath,
        title: file.name.replace(/\.(pdf|docx|txt)$/i, ''),
        total_paragraphs: 0,
      });

      // Call edge function to parse the PDF
      const { data, error } = await supabase.functions.invoke('parse-thesis', {
        body: { file_path: filePath }
      });

      if (error) {
        console.error('Parse error:', error);
        setParseError('Failed to parse PDF. The file may be image-based or encrypted.');
        // Still keep the document but with 0 paragraphs
        toast({
          title: "PDF parsing failed",
          description: "You can still manually enter paragraph text to check.",
          variant: "destructive",
        });
      } else if (data.error) {
        setParseError(data.message || data.error);
        toast({
          title: "Could not extract text",
          description: data.message || "Try a different file or manually enter text.",
          variant: "destructive",
        });
      } else if (data.paragraphs && data.paragraphs.length > 0) {
        setUploadStatus(`Found ${data.paragraphs.length} paragraphs, saving...`);
        
        // Create paragraph records
        await createThesisParagraphs(
          data.paragraphs.map((text: string, index: number) => ({
            thesis_document_id: doc.id,
            index,
            text,
          }))
        );

        // Update the document with paragraph count
        await supabase
          .from('thesis_documents')
          .update({ total_paragraphs: data.paragraphs.length })
          .eq('id', doc.id);

        toast({
          title: "Thesis uploaded",
          description: `Found ${data.paragraphs.length} paragraphs.`,
        });
        
        onDocumentSelect(doc.id);
      } else {
        setParseError('No text paragraphs found in the PDF.');
      }

      onDocumentsUpdate();
    } catch (error) {
      console.error('Upload error:', error);
      toast({ title: "Failed to upload thesis", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsUploading(false);
      setUploadStatus('');
      // Reset the input
      e.target.value = '';
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
    setParseError(null);
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
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
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

      {uploadStatus && (
        <p className="text-sm text-muted-foreground animate-pulse">{uploadStatus}</p>
      )}

      {parseError && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>PDF Parsing Issue</AlertTitle>
          <AlertDescription className="text-sm">
            {parseError}
            <br />
            <span className="text-xs">You can still paste paragraph text manually in the text area below.</span>
          </AlertDescription>
        </Alert>
      )}

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
