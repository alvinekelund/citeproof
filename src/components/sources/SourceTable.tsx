import { useState } from "react";
import { ExternalLink, Pencil, Trash2, Save, X } from "lucide-react";
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
import { Source, CitationStyle, CITATION_STYLES } from "@/lib/types";
import { updateSource, deleteSource, getFileUrl } from "@/lib/supabase-helpers";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface SourceTableProps {
  sources: Source[];
  onUpdate: () => void;
}

export function SourceTable({ sources, onUpdate }: SourceTableProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Source>>({});
  const [deleteId, setDeleteId] = useState<string | null>(null);

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
      await updateSource(editingId, editData);
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
      await deleteSource(deleteId);
      toast({ title: "Source deleted" });
      onUpdate();
    } catch (error) {
      toast({ title: "Failed to delete source", variant: "destructive" });
    } finally {
      setDeleteId(null);
    }
  };

  const openFile = (source: Source) => {
    const url = getFileUrl(source.file_path);
    window.open(url, '_blank');
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

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-secondary/30">
              <TableHead className="font-semibold">In-text Label</TableHead>
              <TableHead className="font-semibold">Authors</TableHead>
              <TableHead className="font-semibold w-20">Year</TableHead>
              <TableHead className="font-semibold">Style</TableHead>
              <TableHead className="font-semibold">File</TableHead>
              <TableHead className="font-semibold w-24">Actions</TableHead>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openFile(source)}
                    className="text-primary hover:text-primary/80"
                  >
                    <ExternalLink className="h-4 w-4 mr-1" />
                    Open
                  </Button>
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
