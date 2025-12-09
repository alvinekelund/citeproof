import { useCallback, useState } from "react";
import { Upload, FileText, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadFile, createSource, generateShorthandId, updateSource } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { CitationStyle, CITATION_STYLES } from "@/lib/types";
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
        
        // Upload file to storage
        const filePath = await uploadFile(file, 'sources');
        const shorthandId = generateShorthandId(file.name);
        
        // Create source record
        const source = await createSource({
          in_text_label: '',
          shorthand_id: shorthandId,
          filename: filePath.split('/').pop() || file.name,
          original_filename: file.name,
          file_path: filePath,
          citation_style: citationStyle,
        });

        // Try to get AI suggestion for metadata
        try {
          setUploadProgress(prev => [...prev, `Extracting metadata from ${file.name}...`]);
          
          const { data, error } = await supabase.functions.invoke('suggest-label', {
            body: { 
              filename: file.name, 
              shorthand_id: shorthandId,
              citation_style: citationStyle,
            }
          });
          
          if (!error && data) {
            // Update the source with AI suggestions
            const updates: any = {};
            if (data.suggested_label) updates.in_text_label = data.suggested_label;
            if (data.authors) updates.authors = data.authors;
            if (data.year) updates.year = data.year;
            if (data.title) updates.title = data.title;
            
            if (Object.keys(updates).length > 0) {
              await updateSource(source.id, updates);
              setUploadProgress(prev => [...prev, `✓ ${file.name} uploaded with metadata`]);
            } else {
              setUploadProgress(prev => [...prev, `✓ ${file.name} uploaded`]);
            }
          } else {
            setUploadProgress(prev => [...prev, `✓ ${file.name} uploaded`]);
          }
        } catch {
          setUploadProgress(prev => [...prev, `✓ ${file.name} uploaded`]);
        }
      } catch (error) {
        console.error('Upload error:', error);
        setUploadProgress(prev => [...prev, `✗ Failed to upload ${file.name}`]);
      }
    }

    setIsUploading(false);
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
