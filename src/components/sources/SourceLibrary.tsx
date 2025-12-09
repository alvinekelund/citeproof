import { useEffect, useState, useMemo } from "react";
import { Library, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceDropzone } from "./SourceDropzone";
import { SourceTable } from "./SourceTable";
import { Source } from "@/lib/types";
import { getSources } from "@/lib/client-storage";
import { UnmatchedCitation } from "@/components/audit/CopilotMode";

interface SourceLibraryProps {
  usedSourceIds?: Set<string>;
  unmatchedCitations?: UnmatchedCitation[];
  onSourcesUpdated?: () => void;
  onLinkCitation?: (sourceId: string, citationLabel: string) => void;
}

// Combined type for display - either a real source or an unmatched citation placeholder
export type LibraryItem = 
  | { type: 'source'; data: Source; status: 'used' | 'unused' }
  | { type: 'unmatched'; data: UnmatchedCitation };

export function SourceLibrary({ usedSourceIds, unmatchedCitations = [], onSourcesUpdated, onLinkCitation }: SourceLibraryProps) {
  const [sources, setSources] = useState<Source[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadSources = () => {
    setIsLoading(true);
    try {
      const data = getSources();
      setSources(data);
    } catch (error) {
      console.error('Failed to load sources:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Called when sources are modified (linked, edited, etc.)
  const handleSourcesUpdate = () => {
    loadSources();
    // Notify parent to re-analyze citations
    onSourcesUpdated?.();
  };

  useEffect(() => {
    loadSources();
  }, []);

  // Create combined list of sources and unmatched citations
  const libraryItems = useMemo((): LibraryItem[] => {
    const items: LibraryItem[] = [];
    
    // Add real sources with their status
    for (const source of sources) {
      const isUsed = usedSourceIds && usedSourceIds.size > 0 && usedSourceIds.has(source.id);
      items.push({
        type: 'source',
        data: source,
        status: isUsed ? 'used' : 'unused',
      });
    }
    
    // Add unmatched citations (missing from library)
    for (const citation of unmatchedCitations) {
      items.push({
        type: 'unmatched',
        data: citation,
      });
    }
    
    // Sort: unmatched (red) first, then unused (amber), then used (green)
    items.sort((a, b) => {
      const order = { unmatched: 0, unused: 1, used: 2 };
      const aOrder = a.type === 'unmatched' ? order.unmatched : order[a.status];
      const bOrder = b.type === 'unmatched' ? order.unmatched : order[b.status];
      return aOrder - bOrder;
    });
    
    return items;
  }, [sources, usedSourceIds, unmatchedCitations]);

  const unusedCount = usedSourceIds && usedSourceIds.size > 0 
    ? sources.filter(s => !usedSourceIds.has(s.id)).length 
    : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Library className="h-6 w-6 text-primary" />
          <div>
            <h2 className="scholarly-heading text-2xl font-bold">Source Library</h2>
            <p className="text-sm text-muted-foreground">
              {sources.length} source{sources.length !== 1 ? 's' : ''} in your library
              {unmatchedCitations.length > 0 && (
                <span className="text-destructive ml-2">
                  ({unmatchedCitations.length} missing)
                </span>
              )}
              {unusedCount > 0 && (
                <span className="text-amber-500 ml-2">
                  ({unusedCount} not used)
                </span>
              )}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={loadSources} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px,1fr]">
        <div>
          <SourceDropzone onUploadComplete={handleSourcesUpdate} />
        </div>
        <div>
          <SourceTable 
            sources={sources} 
            libraryItems={libraryItems}
            onUpdate={handleSourcesUpdate} 
            usedSourceIds={usedSourceIds}
            onLinkCitation={onLinkCitation}
          />
        </div>
      </div>
    </div>
  );
}
