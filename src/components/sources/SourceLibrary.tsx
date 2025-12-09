import { useEffect, useState } from "react";
import { Library, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SourceDropzone } from "./SourceDropzone";
import { SourceTable } from "./SourceTable";
import { Source } from "@/lib/types";
import { getSources } from "@/lib/client-storage";

export function SourceLibrary() {
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

  useEffect(() => {
    loadSources();
  }, []);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Library className="h-6 w-6 text-primary" />
          <div>
            <h2 className="scholarly-heading text-2xl font-bold">Source Library</h2>
            <p className="text-sm text-muted-foreground">
              {sources.length} source{sources.length !== 1 ? 's' : ''} in your library
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
          <SourceDropzone onUploadComplete={loadSources} />
        </div>
        <div>
          <SourceTable sources={sources} onUpdate={loadSources} />
        </div>
      </div>
    </div>
  );
}
