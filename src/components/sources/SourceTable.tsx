import { useState, useMemo } from "react";
import { Eye, Pencil, Trash2, Save, X, RefreshCw, Loader2, ArrowUpDown, ArrowUp, ArrowDown, AlertCircle, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { updateSource, deleteSource, downloadSourceFile } from "@/lib/client-storage";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { extractTextFromFile } from "@/lib/pdf-parser";
import { extractMetadataFromText } from "@/lib/metadata-extractor";
import { PdfViewerDialog } from "./PdfViewerDialog";
import { LibraryItem } from "./SourceLibrary";

type SortField = 'status' | 'in_text_label' | 'authors' | 'year' | 'created_at';
type SortDirection = 'asc' | 'desc';

interface SourceTableProps {
  sources: Source[];
  libraryItems?: LibraryItem[];
  onUpdate: () => void;
  usedSourceIds?: Set<string>;
}

export function SourceTable({ sources, libraryItems, onUpdate, usedSourceIds }: SourceTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Source>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [extractingId, setExtractingId] = useState<string | null>(null);
  const [viewingSource, setViewingSource] = useState<Source | null>(null);
  const [sortField, setSortField] = useState<SortField>('status');
  const [linkingCitation, setLinkingCitation] = useState<string | null>(null);

  // Get unused sources for linking
  const unusedSources = useMemo(() => {
    return sources.filter(s => !usedSourceIds || !usedSourceIds.has(s.id));
  }, [sources, usedSourceIds]);

  // Link a missing citation to an existing source
  const linkCitationToSource = (citationLabel: string, sourceId: string) => {
    try {
      updateSource(sourceId, { in_text_label: citationLabel });
      toast({ title: "Citation linked", description: `Source updated with label: ${citationLabel}` });
      setLinkingCitation(null);
      onUpdate();
    } catch (error) {
      toast({ title: "Failed to link citation", variant: "destructive" });
    }
  };
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // If libraryItems provided with content, use those; otherwise fall back to sources
  const displayItems = useMemo(() => {
    // Use libraryItems if it has content, otherwise build from sources
    const hasLibraryItems = libraryItems && libraryItems.length > 0;
    if (hasLibraryItems) {
      // Already sorted by status in SourceLibrary, but allow re-sorting
      return [...libraryItems].sort((a, b) => {
        // Status order: unmatched (0) < unused (1) < used (2)
        const getStatusOrder = (item: LibraryItem) => {
          if (item.type === 'unmatched') return 0;
          return item.status === 'unused' ? 1 : 2;
        };
        
        let aVal: any, bVal: any;
        
        switch (sortField) {
          case 'status':
            aVal = getStatusOrder(a);
            bVal = getStatusOrder(b);
            break;
          case 'in_text_label':
            aVal = (a.type === 'source' ? a.data.in_text_label : a.data.label)?.toLowerCase() || '';
            bVal = (b.type === 'source' ? b.data.in_text_label : b.data.label)?.toLowerCase() || '';
            break;
          case 'authors':
            aVal = (a.type === 'source' ? a.data.authors : '')?.toLowerCase() || '';
            bVal = (b.type === 'source' ? b.data.authors : '')?.toLowerCase() || '';
            break;
          case 'year':
            aVal = a.type === 'source' ? (a.data.year || 0) : (a.data.year || 0);
            bVal = b.type === 'source' ? (b.data.year || 0) : (b.data.year || 0);
            break;
          case 'created_at':
            aVal = a.type === 'source' ? new Date(a.data.created_at).getTime() : 0;
            bVal = b.type === 'source' ? new Date(b.data.created_at).getTime() : 0;
            break;
          default:
            return 0;
        }
        
        if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    // Fallback: use sources directly when no libraryItems available
    return [...sources].sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortField) {
        case 'in_text_label':
          aVal = a.in_text_label?.toLowerCase() || '';
          bVal = b.in_text_label?.toLowerCase() || '';
          break;
        case 'authors':
          aVal = a.authors?.toLowerCase() || '';
          bVal = b.authors?.toLowerCase() || '';
          break;
        case 'year':
          aVal = a.year || 0;
          bVal = b.year || 0;
          break;
        case 'created_at':
          aVal = new Date(a.created_at).getTime();
          bVal = new Date(b.created_at).getTime();
          break;
        default:
          return 0;
      }
      
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    }).map(source => ({
      type: 'source' as const,
      data: source,
      status: (usedSourceIds && usedSourceIds.size > 0 && usedSourceIds.has(source.id)) ? 'used' as const : 'unused' as const,
    }));
  }, [libraryItems, sources, usedSourceIds, sortField, sortDirection]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown className="h-4 w-4 opacity-50" />;
    return sortDirection === 'asc' ? <ArrowUp className="h-4 w-4" /> : <ArrowDown className="h-4 w-4" />;
  };

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

  const openFile = (source: Source) => {
    setViewingSource(source);
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

  if (displayItems.length === 0) {
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
              <TableHead className="font-semibold w-16">
                <Button variant="ghost" size="sm" className="h-auto p-0 font-semibold" onClick={() => toggleSort('status')}>
                  Status {getSortIcon('status')}
                </Button>
              </TableHead>
              <TableHead className="font-semibold">
                <Button variant="ghost" size="sm" className="h-auto p-0 font-semibold" onClick={() => toggleSort('in_text_label')}>
                  In-text Label {getSortIcon('in_text_label')}
                </Button>
              </TableHead>
              <TableHead className="font-semibold">
                <Button variant="ghost" size="sm" className="h-auto p-0 font-semibold" onClick={() => toggleSort('authors')}>
                  Authors {getSortIcon('authors')}
                </Button>
              </TableHead>
              <TableHead className="font-semibold w-20">
                <Button variant="ghost" size="sm" className="h-auto p-0 font-semibold" onClick={() => toggleSort('year')}>
                  Year {getSortIcon('year')}
                </Button>
              </TableHead>
              <TableHead className="font-semibold">File</TableHead>
              <TableHead className="font-semibold w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayItems.map((item, idx) => {
              if (item.type === 'unmatched') {
                // Render unmatched citation row (red)
                const citationLabel = item.data.label;
                return (
                  <TableRow key={`unmatched-${idx}`} className="bg-destructive/10">
                    <TableCell>
                      <span className="text-xs bg-destructive/20 text-destructive px-1.5 py-0.5 rounded flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Missing
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="font-mono text-sm text-destructive">
                        {citationLabel}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground">—</span>
                    </TableCell>
                    <TableCell>
                      <span className={cn(!item.data.year && "text-muted-foreground")}>
                        {item.data.year || '—'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground text-sm">No file</span>
                    </TableCell>
                    <TableCell>
                      {unusedSources.length > 0 ? (
                        <Popover open={linkingCitation === citationLabel} onOpenChange={(open) => setLinkingCitation(open ? citationLabel : null)}>
                          <PopoverTrigger asChild>
                            <Button variant="outline" size="sm" className="h-7 text-xs">
                              <Link2 className="h-3 w-3 mr-1" />
                              Link to source
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-72 p-2" align="end">
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground mb-2">
                                Select a source to link:
                              </p>
                              <div className="max-h-48 overflow-y-auto space-y-1">
                                {unusedSources.map(source => (
                                  <button
                                    key={source.id}
                                    onClick={() => linkCitationToSource(citationLabel, source.id)}
                                    className="w-full text-left px-2 py-1.5 rounded hover:bg-secondary text-sm transition-colors"
                                  >
                                    <div className="font-medium truncate">
                                      {source.authors || source.original_filename}
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">
                                      {source.title || source.original_filename}
                                      {source.year && ` (${source.year})`}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      ) : (
                        <span className="text-xs text-muted-foreground">Upload PDF to match</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              }
              
              // Render source row
              const source = item.data;
              const isUsed = item.status === 'used';
              const isUnused = item.status === 'unused';
              
              return (
                <TableRow 
                  key={source.id} 
                  className={cn(
                    "source-row",
                    isUsed && "bg-verdict-green-bg/30",
                    isUnused && "bg-amber-500/10"
                  )}
                >
                  <TableCell>
                    {isUsed ? (
                      <span className="text-xs bg-verdict-green-bg text-verdict-green px-1.5 py-0.5 rounded">
                        Used
                      </span>
                    ) : (
                      <span className="text-xs bg-amber-500/20 text-amber-600 px-1.5 py-0.5 rounded">
                        Unused
                      </span>
                    )}
                  </TableCell>
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openFile(source)}
                          className="text-primary hover:text-primary/80"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
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
              );
            })}
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

      <PdfViewerDialog
        open={!!viewingSource}
        onOpenChange={(open) => !open && setViewingSource(null)}
        filePath={viewingSource?.file_path || null}
        fileName={viewingSource?.original_filename || "Document"}
      />
    </>
  );
}
