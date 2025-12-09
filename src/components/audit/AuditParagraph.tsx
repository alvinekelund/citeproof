import { useState, useEffect } from "react";
import { FileCheck, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThesisSelector } from "./ThesisSelector";
import { CheckResult } from "./CheckResult";
import { ThesisDocument, ThesisParagraph, CheckResult as CheckResultType, Source } from "@/lib/types";
import { getSources, getThesisDocuments, createParagraphCheck } from "@/lib/supabase-helpers";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export function AuditParagraph() {
  const [paragraphText, setParagraphText] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [checkResult, setCheckResult] = useState<CheckResultType | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [thesisDocs, setThesisDocs] = useState<ThesisDocument[]>([]);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [currentParagraph, setCurrentParagraph] = useState<ThesisParagraph | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [sourcesData, docsData] = await Promise.all([
        getSources(),
        getThesisDocuments(),
      ]);
      setSources(sourcesData);
      setThesisDocs(docsData);
    } catch (error) {
      console.error('Failed to load data:', error);
    }
  };

  const handleParagraphChange = (paragraph: ThesisParagraph | null) => {
    setCurrentParagraph(paragraph);
    if (paragraph) {
      setParagraphText(paragraph.text);
      setCheckResult(null);
    }
  };

  const runCheck = async () => {
    if (!paragraphText.trim()) {
      toast({ title: "Please enter a paragraph to check", variant: "destructive" });
      return;
    }

    if (sources.length === 0) {
      toast({ 
        title: "No sources available", 
        description: "Add sources to your library first.",
        variant: "destructive" 
      });
      return;
    }

    setIsChecking(true);
    setCheckResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('check-paragraph', {
        body: {
          paragraph: paragraphText,
          sources: sources.map(s => ({
            id: s.id,
            in_text_label: s.in_text_label,
            shorthand_id: s.shorthand_id,
            title: s.title,
            authors: s.authors,
            year: s.year,
          })),
        },
      });

      if (error) {
        throw error;
      }

      if (data.error) {
        toast({ 
          title: "AI Check Failed", 
          description: data.error,
          variant: "destructive" 
        });
        return;
      }

      const result: CheckResultType = data.result;
      setCheckResult(result);

      // Save to history
      await createParagraphCheck({
        thesis_paragraph_id: currentParagraph?.id,
        raw_paragraph_text: paragraphText,
        result_json: result,
        overall_color: result.overall_color,
      });

      toast({ title: "Analysis complete" });
    } catch (error: any) {
      console.error('Check error:', error);
      toast({ 
        title: "Failed to run check", 
        description: error.message || "Please try again later.",
        variant: "destructive" 
      });
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <FileCheck className="h-6 w-6 text-primary" />
        <div>
          <h2 className="scholarly-heading text-2xl font-bold">Audit Paragraph</h2>
          <p className="text-sm text-muted-foreground">
            Verify your thesis claims against uploaded sources
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left column: Input */}
        <div className="space-y-4">
          <ThesisSelector
            documents={thesisDocs}
            selectedDocId={selectedDocId}
            currentParagraph={currentParagraph}
            onDocumentSelect={setSelectedDocId}
            onParagraphChange={handleParagraphChange}
            onDocumentsUpdate={loadData}
          />

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Paragraph to check
            </label>
            <Textarea
              value={paragraphText}
              onChange={(e) => setParagraphText(e.target.value)}
              placeholder="Paste a paragraph from your thesis here. Include any in-text citations like (Author et al., 2023) or [12]..."
              className="min-h-[200px] resize-y"
            />
            <p className="text-xs text-muted-foreground">
              {sources.length} source{sources.length !== 1 ? 's' : ''} available for verification
            </p>
          </div>

          <Button 
            onClick={runCheck} 
            disabled={isChecking || !paragraphText.trim()}
            className="w-full"
            size="lg"
          >
            {isChecking ? (
              <>
                <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5 mr-2" />
                Run Source Check
              </>
            )}
          </Button>
        </div>

        {/* Right column: Results */}
        <div>
          {isChecking && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-12 w-12 animate-spin mb-4" />
              <p>Analyzing claims and verifying sources...</p>
              <p className="text-sm">This may take a moment.</p>
            </div>
          )}

          {!isChecking && checkResult && (
            <CheckResult 
              result={checkResult} 
              paragraphText={paragraphText}
              sources={sources}
            />
          )}

          {!isChecking && !checkResult && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
              <FileCheck className="h-12 w-12 mb-4 opacity-50" />
              <p>Results will appear here</p>
              <p className="text-sm">Enter a paragraph and click "Run Source Check"</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
