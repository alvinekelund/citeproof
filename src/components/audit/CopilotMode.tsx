import { useState, useCallback, useEffect } from "react";
import { Upload, FileText, Loader2, ChevronLeft, ChevronRight, Sparkles, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { extractTextFromFile, splitIntoParagraphs } from "@/lib/pdf-parser";
import { CheckResult as CheckResultType, Source } from "@/lib/types";
import { CheckResult } from "./CheckResult";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { getSources, createParagraphCheck } from "@/lib/client-storage";
import { supabase } from "@/integrations/supabase/client";

interface ParagraphData {
  index: number;
  text: string;
  checked: boolean;
  result?: CheckResultType;
}

export function CopilotMode() {
  const [file, setFile] = useState<File | null>(null);
  const [paragraphs, setParagraphs] = useState<ParagraphData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);

  useEffect(() => {
    setSources(getSources());
  }, []);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    const validExts = ['.pdf', '.docx', '.txt'];
    const ext = uploadedFile.name.toLowerCase().slice(uploadedFile.name.lastIndexOf('.'));
    
    if (!validExts.includes(ext)) {
      toast({ title: "Please select a PDF, DOCX, or TXT file", variant: "destructive" });
      return;
    }

    setIsLoading(true);
    setFile(uploadedFile);
    setParagraphs([]);
    setSelectedIndex(null);

    try {
      const text = await extractTextFromFile(uploadedFile);
      
      if (!text || text.length < 100) {
        toast({ title: "Could not extract text", description: "The file may be image-based or encrypted.", variant: "destructive" });
        return;
      }

      const paragraphTexts = splitIntoParagraphs(text);
      
      if (paragraphTexts.length === 0) {
        toast({ title: "No paragraphs found", variant: "destructive" });
        return;
      }

      setParagraphs(paragraphTexts.map((text, index) => ({
        index,
        text,
        checked: false,
      })));

      toast({ title: "File loaded", description: `Found ${paragraphTexts.length} paragraphs` });
    } catch (error) {
      console.error('Parse error:', error);
      toast({ title: "Failed to parse file", variant: "destructive" });
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  }, []);

  const checkParagraph = async (index: number) => {
    const paragraph = paragraphs[index];
    if (!paragraph) return;

    if (sources.length === 0) {
      toast({ title: "No sources available", description: "Add sources to your library first.", variant: "destructive" });
      return;
    }

    setIsChecking(true);
    setSelectedIndex(index);

    try {
      const { data, error } = await supabase.functions.invoke('check-paragraph', {
        body: {
          paragraph: paragraph.text,
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

      if (error) throw error;

      if (data.error) {
        toast({ title: "AI Check Failed", description: data.error, variant: "destructive" });
        return;
      }

      const result: CheckResultType = data.result;

      // Update paragraph with result
      setParagraphs(prev => prev.map((p, i) => 
        i === index ? { ...p, checked: true, result } : p
      ));

      // Save to history
      createParagraphCheck({
        raw_paragraph_text: paragraph.text,
        result_json: result,
        overall_color: result.overall_color,
      });

      toast({ title: "Analysis complete" });
    } catch (error: any) {
      console.error('Check error:', error);
      toast({ title: "Failed to run check", description: error.message, variant: "destructive" });
    } finally {
      setIsChecking(false);
    }
  };

  const selectedParagraph = selectedIndex !== null ? paragraphs[selectedIndex] : null;

  const navigateParagraph = (direction: 'prev' | 'next') => {
    if (selectedIndex === null) return;
    const newIndex = direction === 'next' ? selectedIndex + 1 : selectedIndex - 1;
    if (newIndex >= 0 && newIndex < paragraphs.length) {
      setSelectedIndex(newIndex);
    }
  };

  const getColorClass = (result?: CheckResultType) => {
    if (!result) return '';
    switch (result.overall_color) {
      case 'green': return 'border-l-verdict-green bg-verdict-green-bg/30';
      case 'yellow': return 'border-l-verdict-yellow bg-verdict-yellow-bg/30';
      case 'red': return 'border-l-verdict-red bg-verdict-red-bg/30';
      default: return '';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <BookOpen className="h-6 w-6 text-primary" />
        <div>
          <h2 className="scholarly-heading text-2xl font-bold">Copilot Mode</h2>
          <p className="text-sm text-muted-foreground">
            Parse your thesis and check paragraphs interactively
          </p>
        </div>
      </div>

      {/* File Upload */}
      {!file && (
        <div className="border-2 border-dashed rounded-xl p-12 text-center">
          <input
            type="file"
            accept=".pdf,.docx,.txt"
            onChange={handleFileUpload}
            className="hidden"
            id="copilot-upload"
            disabled={isLoading}
          />
          <label htmlFor="copilot-upload" className="cursor-pointer block">
            {isLoading ? (
              <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin" />
            ) : (
              <Upload className="h-12 w-12 mx-auto text-muted-foreground" />
            )}
            <h3 className="mt-4 font-semibold">
              {isLoading ? "Processing..." : "Upload your thesis"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              PDF, DOCX, or TXT files supported
            </p>
          </label>
        </div>
      )}

      {/* Main Interface */}
      {file && paragraphs.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Left: Paragraph List */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                <span className="font-medium">{file.name}</span>
                <Badge variant="secondary">{paragraphs.length} paragraphs</Badge>
              </div>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => { setFile(null); setParagraphs([]); setSelectedIndex(null); }}
              >
                Change File
              </Button>
            </div>

            <ScrollArea className="h-[600px] border rounded-lg">
              <div className="p-2 space-y-2">
                {paragraphs.map((p, i) => (
                  <Card
                    key={i}
                    className={cn(
                      "p-3 cursor-pointer transition-all hover:shadow-md border-l-4",
                      selectedIndex === i && "ring-2 ring-primary",
                      p.checked ? getColorClass(p.result) : "border-l-transparent",
                    )}
                    onClick={() => setSelectedIndex(i)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-medium text-muted-foreground">¶{i + 1}</span>
                          {p.checked && p.result && (
                            <VerdictBadge color={p.result.overall_color} size="sm" />
                          )}
                        </div>
                        <p className="text-sm line-clamp-3">{p.text}</p>
                      </div>
                      <Button
                        variant={p.checked ? "outline" : "default"}
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); checkParagraph(i); }}
                        disabled={isChecking && selectedIndex === i}
                        className="shrink-0"
                      >
                        {isChecking && selectedIndex === i ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <Sparkles className="h-4 w-4 mr-1" />
                            {p.checked ? 'Recheck' : 'Check'}
                          </>
                        )}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Right: Results */}
          <div className="space-y-4">
            {selectedParagraph && (
              <>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Paragraph {selectedIndex! + 1} of {paragraphs.length}</span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateParagraph('prev')}
                      disabled={selectedIndex === 0}
                    >
                      <ChevronLeft className="h-4 w-4" />
                      Prev
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => navigateParagraph('next')}
                      disabled={selectedIndex === paragraphs.length - 1}
                    >
                      Next
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Full paragraph text */}
                <Card className="p-4 bg-secondary/30">
                  <p className="text-sm whitespace-pre-wrap">{selectedParagraph.text}</p>
                </Card>

                {/* Result or prompt to check */}
                {selectedParagraph.checked && selectedParagraph.result ? (
                  <CheckResult
                    result={selectedParagraph.result}
                    paragraphText={selectedParagraph.text}
                    sources={sources}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
                    <Sparkles className="h-12 w-12 mb-4 opacity-50" />
                    <p>Click "Check" to analyze this paragraph</p>
                    <Button 
                      className="mt-4" 
                      onClick={() => checkParagraph(selectedIndex!)}
                      disabled={isChecking || sources.length === 0}
                    >
                      {isChecking ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Check This Paragraph
                    </Button>
                    {sources.length === 0 && (
                      <p className="text-xs text-destructive mt-2">Add sources to your library first</p>
                    )}
                  </div>
                )}
              </>
            )}

            {!selectedParagraph && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground border-2 border-dashed rounded-lg">
                <BookOpen className="h-12 w-12 mb-4 opacity-50" />
                <p>Select a paragraph to view details</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
