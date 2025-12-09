import { useCallback, useState } from "react";
import { Upload, FileText, Loader2, Sparkles, Link } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadFile, createSource, generateShorthandId, updateSource, getPendingCitations, removePendingCitation } from "@/lib/client-storage";
import { toast } from "@/hooks/use-toast";
import { CitationStyle, CITATION_STYLES } from "@/lib/types";
import { extractTextFromFile } from "@/lib/pdf-parser";
import { extractMetadataFromText } from "@/lib/metadata-extractor";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface SourceDropzoneProps {
  onUploadComplete: () => void;
}

export function SourceDropzone({ onUploadComplete }: SourceDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string[]>([]);
  const [citationStyle, setCitationStyle] = useState<CitationStyle>('apa7');
  const [pendingCitations, setPendingCitations] = useState(getPendingCitations());

  // Refresh pending citations
  const refreshPending = () => {
    setPendingCitations(getPendingCitations());
  };

  const handleFiles = useCallback(async (files: FileList) => {
    const pdfFiles = Array.from(files).filter(f => f.type === 'application/pdf');
    
    if (pdfFiles.length === 0) {
      toast({
        title: "No PDFs found",
        description: "Please upload PDF files only.",
        variant: "destructive",
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress([]);

    for (const file of pdfFiles) {
      try {
        setUploadProgress(prev => [...prev, `Uploading ${file.name}...`]);
        
        // Upload file to IndexedDB
        const filePath = await uploadFile(file, 'sources');
        const shorthandId = generateShorthandId(file.name);
        
        // Create source record
        const source = createSource({
          in_text_label: '',
          shorthand_id: shorthandId,
          filename: filePath.split('/').pop() || file.name,
          original_filename: file.name,
          file_path: filePath,
          citation_style: citationStyle,
        });

        // Try to extract metadata from the file
        let extractedAuthor = '';
        let extractedYear: number | null = null;
        
        try {
          setUploadProgress(prev => [...prev, `Extracting metadata from ${file.name}...`]);
          
          const text = await extractTextFromFile(file);
          
          if (text && text.length > 50) {
            const metadata = await extractMetadataFromText(
              text,
              file.name,
              citationStyle
            );
            
            if (metadata && Object.keys(metadata).length > 0) {
              const updates: any = {};
              if (metadata.suggested_label) updates.in_text_label = metadata.suggested_label;
              if (metadata.authors) {
                updates.authors = metadata.authors;
                // Extract first author surname for matching
                const match = metadata.authors.match(/^([A-Z][a-zA-Z''-]+)/);
                if (match) extractedAuthor = match[1].toLowerCase();
              }
              if (metadata.year) {
                updates.year = metadata.year;
                extractedYear = metadata.year;
              }
              if (metadata.title) updates.title = metadata.title;
              
              if (Object.keys(updates).length > 0) {
                updateSource(source.id, updates);
                setUploadProgress(prev => [...prev, `✓ ${file.name} uploaded with metadata`]);
              } else {
                setUploadProgress(prev => [...prev, `✓ ${file.name} uploaded`]);
              }
            } else {
              setUploadProgress(prev => [...prev, `✓ ${file.name} uploaded`]);
            }
          } else {
            setUploadProgress(prev => [...prev, `✓ ${file.name} uploaded`]);
          }
        } catch {
          setUploadProgress(prev => [...prev, `✓ ${file.name} uploaded`]);
        }

        // Try to match with pending citations
        if (extractedAuthor || extractedYear) {
          const currentPending = getPendingCitations();
          const matched = currentPending.find(p => {
            const pendingAuthor = p.author.toLowerCase();
            const yearMatches = !p.year || !extractedYear || p.year === extractedYear;
            return pendingAuthor === extractedAuthor && yearMatches;
          });
          
          if (matched) {
            // Update the source with the pending citation label
            updateSource(source.id, { in_text_label: matched.label });
            removePendingCitation(matched.id);
            setUploadProgress(prev => [...prev, `🔗 Matched to citation: ${matched.label}`]);
          }
        }
      } catch (error) {
        console.error('Upload error:', error);
        setUploadProgress(prev => [...prev, `✗ Failed to upload ${file.name}`]);
      }
    }

    setIsUploading(false);
    refreshPending();
    onUploadComplete();
    toast({
      title: "Upload complete",
      description: `${pdfFiles.length} source(s) added to your library.`,
    });
  }, [onUploadComplete, citationStyle]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  }, [handleFiles]);

  const selectedStyle = CITATION_STYLES.find(s => s.value === citationStyle);

  return (
    <div className="space-y-4">
      {/* Pending Citations */}
      {pendingCitations.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Link className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-700">
              {pendingCitations.length} citation{pendingCitations.length > 1 ? 's' : ''} waiting for match
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {pendingCitations.slice(0, 8).map(p => (
              <Badge 
                key={p.id} 
                variant="outline" 
                className="text-xs text-amber-700 border-amber-500/50 cursor-pointer hover:bg-amber-500/20"
                onClick={() => {
                  removePendingCitation(p.id);
                  refreshPending();
                }}
                title="Click to remove from queue"
              >
                {p.label}
              </Badge>
            ))}
            {pendingCitations.length > 8 && (
              <Badge variant="secondary" className="text-xs">
                +{pendingCitations.length - 8} more
              </Badge>
            )}
          </div>
          <p className="text-xs text-amber-600 mt-2">
            Upload PDFs below - they'll auto-match to these citations
          </p>
        </div>
      )}

      {/* Citation Style Selector */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Citation Style</label>
        <Select value={citationStyle} onValueChange={(v) => setCitationStyle(v as CitationStyle)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CITATION_STYLES.map(style => (
              <SelectItem key={style.value} value={style.value}>
                <div className="flex flex-col">
                  <span>{style.label}</span>
                  <span className="text-xs text-muted-foreground font-mono">{style.example}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedStyle && (
          <p className="text-xs text-muted-foreground">
            Example in-text citation: <span className="font-mono">{selectedStyle.example}</span>
          </p>
        )}
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn("dropzone text-center cursor-pointer", isDragging && "dropzone-active")}
      >
        <input
          type="file"
          accept=".pdf"
          multiple
          onChange={handleInputChange}
          className="hidden"
          id="source-upload"
          disabled={isUploading}
        />
        <label htmlFor="source-upload" className="cursor-pointer block">
          {isUploading ? (
            <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin" />
          ) : (
            <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
          )}
          <h3 className="mt-4 font-semibold text-foreground">
            {isUploading ? "Uploading..." : "Drop PDF sources here"}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {isUploading ? "Please wait..." : "or click to browse"}
          </p>
          <p className="mt-2 text-xs text-muted-foreground flex items-center justify-center gap-1">
            <Sparkles className="h-3 w-3" />
            AI will auto-extract author, year, and title
          </p>
        </label>
      </div>

      {uploadProgress.length > 0 && (
        <div className="bg-secondary/50 rounded-lg p-4 space-y-1 max-h-40 overflow-y-auto">
          {uploadProgress.map((msg, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className={cn(
                msg.startsWith('✗') ? "text-destructive" : 
                msg.startsWith('✓') ? "text-verdict-green" : 
                msg.startsWith('🔗') ? "text-amber-600 font-medium" :
                "text-muted-foreground"
              )}>
                {msg}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
