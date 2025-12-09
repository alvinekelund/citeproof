import { useState } from "react";
import { ExternalLink, Pencil, Trash2, Save, X, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Source, CitationStyle, CITATION_STYLES } from "@/lib/types";
import { updateSource, deleteSource, downloadSourceFile, openFileInNewTab } from "@/lib/client-storage";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { extractTextFromFile } from "@/lib/pdf-parser";
import { extractMetadataFromText } from "@/lib/metadata-extractor";

interface SourceTableProps {
  sources: Source[];
  onUpdate: () => void;
}

export function SourceTable({ sources, onUpdate }: SourceTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Source>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [extractingId, setExtractingId] = useState<string | null>(null);

  const startEdit = (source: Source) => {
    setEditingId(source.id);
    setEditData({
      in_text_label: source.in_text_label,
      title: source.title || '',
      authors: source.authors || '',
      year: source.year,
      notes: source.notes || '',
      citation_style: source.citation_style || 'apa7',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditData({});
  };

  const saveEdit = async () => {
    if (!editingId) return;
    
    try {
      updateSource(editingId, editData);
      toast({ title: "Source updated" });
      onUpdate();
    } catch (error) {
      toast({ title: "Failed to update source", variant: "destructive" });
    } finally {
      cancelEdit();
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    
    try {
      deleteSource(deleteId);
      toast({ title: "Source deleted" });
      onUpdate();
    } catch (error) {
      toast({ title: "Failed to delete source", variant: "destructive" });
    } finally {
      setDeleteId(null);
    }
  };

  const openFile = async (source: Source) => {
    const success = await openFileInNewTab(source.file_path);
    if (!success) {
      toast({ 
        title: "Could not open file", 
        description: "The file may have been deleted or the browser blocked the popup.",
        variant: "destructive" 
      });
    }
  };

  const extractMetadata = async (source: Source) => {
    setExtractingId(source.id);
    try {
      // Download the file from IndexedDB
      const file = await downloadSourceFile(source.file_path);
      
      if (!file) {
        throw new Error('Could not find file');
      }
      
      // Extract text client-side
      const text = await extractTextFromFile(file);
      
      if (!text || text.length < 50) {
        toast({ title: "No text found", description: "Could not extract text from file.", variant: "destructive" });
        return;
      }
      
      // Use AI to extract metadata from text
      const metadata = await extractMetadataFromText(
        text,
        source.original_filename,
        source.citation_style || 'apa7'
      );
      
      if (metadata && Object.keys(metadata).length > 0) {
        const updates: Partial<Source> = {};
        if (metadata.suggested_label) updates.in_text_label = metadata.suggested_label;
        if (metadata.authors) updates.authors = metadata.authors;
        if (metadata.year) updates.year = metadata.year;
        if (metadata.title) updates.title = metadata.title;
        
        if (Object.keys(updates).length > 0) {
          updateSource(source.id, updates);
          toast({ title: "Metadata extracted", description: "Source updated with AI-extracted metadata." });
          onUpdate();
        } else {
          toast({ title: "No metadata found", description: "Could not extract metadata from file.", variant: "destructive" });
        }
      }
    } catch (error) {
      console.error('Extraction error:', error);
      toast({ title: "Extraction failed", description: String(error), variant: "destructive" });
    } finally {
      setExtractingId(null);
    }
  };

  const extractAllMetadata = async () => {
    const sourcesWithoutMetadata = sources.filter(s => !s.in_text_label && !s.authors);
    if (sourcesWithoutMetadata.length === 0) {
      toast({ title: "All sources have metadata" });
      return;
    }

    toast({ title: "Extracting metadata...", description: `Processing ${sourcesWithoutMetadata.length} sources.` });

    for (const source of sourcesWithoutMetadata) {
      await extractMetadata(source);
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 500));
    }

    toast({ title: "Extraction complete" });
  };

  const getStyleLabel = (style: CitationStyle) => {
    return CITATION_STYLES.find(s => s.value === style)?.label || style;
  };

  if (sources.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>No sources yet. Upload PDFs above to get started.</p>
      </div>
    );
  }

  const hasSourcesWithoutMetadata = sources.some(s => !s.in_text_label && !s.authors);

  return (
    <>
      {hasSourcesWithoutMetadata && (
        <div className="mb-4 p-3 bg-secondary/50 rounded-lg flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Some sources are missing metadata
          </span>
          <Button variant="outline" size="sm" onClick={extractAllMetadata}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Extract All Metadata
          </Button>
        </div>
      )}

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/30">
              <TableHead className="font-semibold">In-text Label</TableHead>
              <TableHead className="font-semibold">Authors</TableHead>
              <TableHead className="font-semibold w-20">Year</TableHead>
              <TableHead className="font-semibold">Style</TableHead>
              <TableHead className="font-semibold">File</TableHead>
              <TableHead className="font-semibold w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((source) => (
              <TableRow key={source.id} className="source-row">
                <TableCell>
                  {editingId === source.id ? (
                    <Input
                      value={editData.in_text_label || ''}
                      onChange={(e) => setEditData({ ...editData, in_text_label: e.target.value })}
                      placeholder="(Author et al., 2023)"
                      className="h-8"
                    />
                  ) : (
                    <span className={cn(
                      "font-mono text-sm",
                      !source.in_text_label && "text-muted-foreground italic"
                    )}>
                      {source.in_text_label || 'No label set'}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === source.id ? (
                    <Input
                      value={editData.authors || ''}
                      onChange={(e) => setEditData({ ...editData, authors: e.target.value })}
                      placeholder="Authors"
                      className="h-8"
                    />
                  ) : (
                    <div>
                      <span className={cn(!source.authors && "text-muted-foreground")}>
                        {source.authors || '—'}
                      </span>
                      {source.title && (
                        <p className="text-xs text-muted-foreground truncate max-w-[200px]" title={source.title}>
                          {source.title}
                        </p>
                      )}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === source.id ? (
                    <Input
                      type="number"
                      value={editData.year || ''}
                      onChange={(e) => setEditData({ ...editData, year: parseInt(e.target.value) || undefined })}
                      placeholder="Year"
                      className="h-8 w-20"
                    />
                  ) : (
                    <span className={cn(!source.year && "text-muted-foreground")}>
                      {source.year || '—'}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  {editingId === source.id ? (
                    <Select
                      value={editData.citation_style || 'apa7'}
                      onValueChange={(v) => setEditData({ ...editData, citation_style: v as CitationStyle })}
                    >
                      <SelectTrigger className="h-8 w-28">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CITATION_STYLES.map(style => (
                          <SelectItem key={style.value} value={style.value}>
                            {style.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs bg-secondary px-2 py-1 rounded">
                      {getStyleLabel(source.citation_style)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openFile(source)}
                        className="text-primary hover:text-primary/80"
                      >
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Open
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">{source.original_filename}</p>
                    </TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell>
                  {editingId === source.id ? (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={saveEdit} className="h-8 w-8 text-verdict-green">
                        <Save className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={cancelEdit} className="h-8 w-8">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            onClick={() => extractMetadata(source)} 
                            disabled={extractingId === source.id}
                            className="h-8 w-8"
                          >
                            {extractingId === source.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Re-extract metadata</TooltipContent>
                      </Tooltip>
                      <Button variant="ghost" size="icon" onClick={() => startEdit(source)} className="h-8 w-8">
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleteId(source.id)} className="h-8 w-8 text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete source?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this source from your library. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
