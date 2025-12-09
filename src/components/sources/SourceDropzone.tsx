import { useCallback, useState } from "react";
import { Upload, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadFile, createSource, generateShorthandId, getFileUrl } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface SourceDropzoneProps {
  onUploadComplete: () => void;
}

export function SourceDropzone({ onUploadComplete }: SourceDropzoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<string[]>([]);

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
        await createSource({
          in_text_label: '',
          shorthand_id: shorthandId,
          filename: filePath.split('/').pop() || file.name,
          original_filename: file.name,
          file_path: filePath,
        });

        // Try to get AI suggestion for the label
        try {
          const { data, error } = await supabase.functions.invoke('suggest-label', {
            body: { filename: file.name, shorthand_id: shorthandId }
          });
          
          if (!error && data?.suggested_label) {
            // We could update the source here, but let's let users do it manually
            setUploadProgress(prev => [...prev, `✓ ${file.name} uploaded (AI suggestion available)`]);
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
  }, [onUploadComplete]);

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

  return (
    <div className="space-y-4">
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
        </label>
      </div>

      {uploadProgress.length > 0 && (
        <div className="bg-secondary/50 rounded-lg p-4 space-y-1">
          {uploadProgress.map((msg, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" />
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
