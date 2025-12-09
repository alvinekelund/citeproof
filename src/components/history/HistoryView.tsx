import { useEffect, useState } from "react";
import { History, Clock, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { VerdictDot, VerdictBadge } from "@/components/ui/verdict-badge";
import { CheckResult } from "@/components/audit/CheckResult";
import { ParagraphCheck, Source } from "@/lib/types";
import { getParagraphChecks, getSources } from "@/lib/client-storage";
import { formatDistanceToNow } from "date-fns";

export function HistoryView() {
  const [checks, setChecks] = useState<ParagraphCheck[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedCheck, setSelectedCheck] = useState<ParagraphCheck | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const checksData = getParagraphChecks();
      const sourcesData = getSources();
      setChecks(checksData);
      setSources(sourcesData);
    } catch (error) {
      console.error('Failed to load history:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const truncateText = (text: string, maxLength: number = 200) => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).trim() + '...';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <History className="h-6 w-6 text-primary" />
        <div>
          <h2 className="scholarly-heading text-2xl font-bold">Check History</h2>
          <p className="text-sm text-muted-foreground">
            {checks.length} previous check{checks.length !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">
          Loading history...
        </div>
      ) : checks.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No checks yet</p>
          <p className="text-sm">Run your first paragraph check from the Audit tab</p>
        </div>
      ) : (
        <div className="space-y-3">
          {checks.map((check) => (
            <div
              key={check.id}
              className="bg-card border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
              onClick={() => setSelectedCheck(check)}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <VerdictDot color={check.overall_color} />
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatDistanceToNow(new Date(check.created_at), { addSuffix: true })}
                    </span>
                    {check.thesis_paragraph_index !== undefined && (
                      <span className="text-xs bg-secondary px-2 py-0.5 rounded">
                        Thesis ¶{check.thesis_paragraph_index + 1}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground line-clamp-3">
                    {truncateText(check.raw_paragraph_text)}
                  </p>
                </div>
                <Button variant="ghost" size="sm">
                  <Eye className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!selectedCheck} onOpenChange={() => setSelectedCheck(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              <span>Check Details</span>
              {selectedCheck && <VerdictBadge color={selectedCheck.overall_color} />}
            </DialogTitle>
          </DialogHeader>
          {selectedCheck && (
            <CheckResult
              result={selectedCheck.result_json}
              paragraphText={selectedCheck.raw_paragraph_text}
              sources={sources}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
