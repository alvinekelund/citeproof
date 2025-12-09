import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, FileText, Loader2, ChevronLeft, ChevronRight, Sparkles, BookOpen, Play, Square, CheckCircle2, FolderOpen, List, History, Trash2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { extractTextFromFile, splitIntoParagraphs, identifyThesisSections, ThesisSection } from "@/lib/pdf-parser";
import { CheckResult as CheckResultType, Source } from "@/lib/types";
import { CheckResult } from "./CheckResult";
import { VerdictBadge } from "@/components/ui/verdict-badge";
import { getSources, createParagraphCheck } from "@/lib/client-storage";
import { supabase } from "@/integrations/supabase/client";
import { analyzeCitations, CitationAnalysis, getMissingSources } from "@/lib/citation-detector";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface ParagraphData {
  index: number;
  text: string;
  checked: boolean;
  result?: CheckResultType;
  sectionType?: 'chapter' | 'section' | 'subsection' | 'paragraph';
  sectionTitle?: string;
  shouldCheck?: boolean; // false for sections that don't need AI verification
}

interface CopilotSession {
  id: string;
  created_at: string;
  updated_at: string;
  thesis_name: string;
  total_paragraphs: number;
  checked_paragraphs: number;
  paragraphs_data: ParagraphData[];
}

export function CopilotMode() {
  const [file, setFile] = useState<File | null>(null);
  const [paragraphs, setParagraphs] = useState<ParagraphData[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isBatchChecking, setIsBatchChecking] = useState(false);
  const [batchProgress, setBatchProgress] = useState(0);
  const [sources, setSources] = useState<Source[]>([]);
  const [showStructure, setShowStructure] = useState(true);
  const abortRef = useRef(false);
  
  // Session management
  const [sessions, setSessions] = useState<CopilotSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(true);
  
  // Citation analysis
  const [citationAnalysis, setCitationAnalysis] = useState<CitationAnalysis | null>(null);
  const [fullText, setFullText] = useState<string>('');

  // Load sources and sessions on mount
  useEffect(() => {
    setSources(getSources());
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setLoadingSessions(true);
    try {
      const { data, error } = await supabase
        .from('copilot_sessions')
        .select('*')
        .order('updated_at', { ascending: false });
      
      if (error) throw error;
      
      // Parse paragraphs_data from JSON
      const parsedSessions = (data || []).map(s => ({
        ...s,
        paragraphs_data: Array.isArray(s.paragraphs_data) 
          ? (s.paragraphs_data as unknown as ParagraphData[]) 
          : []
      }));
      
      setSessions(parsedSessions as CopilotSession[]);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoadingSessions(false);
    }
  };

  const saveSession = async (thesisName: string, paragraphsData: ParagraphData[]) => {
    const checkedCount = paragraphsData.filter(p => p.checked).length;
    
    try {
      if (currentSessionId) {
        // Update existing session
        const { error } = await supabase
          .from('copilot_sessions')
          .update({
            paragraphs_data: paragraphsData as any,
            checked_paragraphs: checkedCount,
          })
          .eq('id', currentSessionId);
        
        if (error) throw error;
      } else {
        // Create new session
        const { data, error } = await supabase
          .from('copilot_sessions')
          .insert({
            thesis_name: thesisName,
            total_paragraphs: paragraphsData.length,
            checked_paragraphs: checkedCount,
            paragraphs_data: paragraphsData as any,
          })
          .select()
          .single();
        
        if (error) throw error;
        setCurrentSessionId(data.id);
      }
      
      // Refresh sessions list
      loadSessions();
    } catch (error) {
      console.error('Failed to save session:', error);
    }
  };

  const loadSession = (session: CopilotSession) => {
    setCurrentSessionId(session.id);
    setParagraphs(session.paragraphs_data);
    setFile({ name: session.thesis_name } as File);
    setSelectedIndex(null);
    toast({ title: "Session loaded", description: `Loaded "${session.thesis_name}"` });
  };

  const deleteSession = async (sessionId: string) => {
    try {
      const { error } = await supabase
        .from('copilot_sessions')
        .delete()
        .eq('id', sessionId);
      
      if (error) throw error;
      
      if (currentSessionId === sessionId) {
        setCurrentSessionId(null);
        setFile(null);
        setParagraphs([]);
        setSelectedIndex(null);
      }
      
      loadSessions();
      toast({ title: "Session deleted" });
    } catch (error) {
      console.error('Failed to delete session:', error);
      toast({ title: "Failed to delete session", variant: "destructive" });
    }
  };

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
    setCurrentSessionId(null);

    try {
      const text = await extractTextFromFile(uploadedFile);
      
      if (!text || text.length < 100) {
        toast({ title: "Could not extract text", description: "The file may be image-based or encrypted.", variant: "destructive" });
        return;
      }

      // Store full text for citation analysis
      setFullText(text);
      
      // Analyze citations against sources
      const currentSources = getSources();
      const analysis = analyzeCitations(text, currentSources);
      setCitationAnalysis(analysis);
      
      if (analysis.missingCount > 0) {
        toast({ 
          title: `${analysis.missingCount} missing sources detected`, 
          description: `Found ${analysis.totalCitations} citations, ${analysis.matchedCount} matched your library.`,
          variant: "destructive" 
        });
      } else if (analysis.totalCitations > 0) {
        toast({ 
          title: `All ${analysis.totalCitations} citations matched!`, 
          description: "Your source library covers all detected citations." 
        });
      }

      const paragraphTexts = splitIntoParagraphs(text);
      const sections = identifyThesisSections(paragraphTexts);
      
      if (paragraphTexts.length === 0) {
        toast({ title: "No paragraphs found", variant: "destructive" });
        return;
      }

      const newParagraphs = sections.map((section) => {
        const shouldCheck = section.shouldCheck;
        
        // For paragraphs that don't need checking, mark them as checked with blue status
        if (!shouldCheck) {
          return {
            index: section.index,
            text: section.content,
            checked: true,
            sectionType: section.type,
            sectionTitle: section.title,
            shouldCheck: false,
            result: {
              summary: section.type === 'paragraph' 
                ? 'This paragraph is in a section that does not require citation verification (e.g., references, acknowledgements, abstract).'
                : 'Section headers do not require verification.',
              overall_color: 'blue' as const,
              claims: [],
              missing_or_ambiguous_citations: [],
            },
          };
        }
        
        return {
          index: section.index,
          text: section.content,
          checked: false,
          sectionType: section.type,
          sectionTitle: section.title,
          shouldCheck: true,
        };
      });

      setParagraphs(newParagraphs);
      
      // Save new session
      await saveSession(uploadedFile.name, newParagraphs);

      toast({ title: "File loaded", description: `Found ${paragraphTexts.length} paragraphs` });
    } catch (error) {
      console.error('Parse error:', error);
      toast({ title: "Failed to parse file", description: String(error), variant: "destructive" });
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  }, []);

  const checkParagraph = async (index: number): Promise<boolean> => {
    const paragraph = paragraphs[index];
    if (!paragraph) return false;

    if (sources.length === 0) {
      toast({ title: "No sources available", description: "Add sources to your library first.", variant: "destructive" });
      return false;
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
        return false;
      }

      const result: CheckResultType = data.result;

      // Update paragraph with result
      const newParagraphs = paragraphs.map((p, i) => 
        i === index ? { ...p, checked: true, result } : p
      );
      setParagraphs(newParagraphs);
      
      // Save session with updated paragraphs
      if (file) {
        await saveSession(file.name, newParagraphs);
      }

      // Save to history
      createParagraphCheck({
        raw_paragraph_text: paragraph.text,
        result_json: result,
        overall_color: result.overall_color,
      });

      return true;
    } catch (error: any) {
      console.error('Check error:', error);
      toast({ title: "Failed to run check", description: error.message, variant: "destructive" });
      return false;
    } finally {
      setIsChecking(false);
    }
  };

  const startBatchCheck = async () => {
    if (sources.length === 0) {
      toast({ title: "No sources available", description: "Add sources to your library first.", variant: "destructive" });
      return;
    }

    // Only check paragraphs that need checking (shouldCheck = true and not already checked)
    const uncheckedParagraphs = paragraphs.filter(p => !p.checked && p.shouldCheck !== false);
    if (uncheckedParagraphs.length === 0) {
      toast({ title: "All paragraphs already checked" });
      return;
    }

    setIsBatchChecking(true);
    abortRef.current = false;
    setBatchProgress(0);

    const totalToCheck = uncheckedParagraphs.length;
    let completed = 0;

    for (const paragraph of paragraphs) {
      if (abortRef.current) {
        toast({ title: "Batch check stopped" });
        break;
      }

      if (!paragraph.checked && paragraph.shouldCheck !== false) {
        await checkParagraph(paragraph.index);
        completed++;
        setBatchProgress((completed / totalToCheck) * 100);
        
        // Small delay between requests to avoid rate limiting
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    setIsBatchChecking(false);
    if (!abortRef.current) {
      toast({ title: "Batch check complete", description: `Checked ${completed} paragraphs` });
    }
  };

  const stopBatchCheck = () => {
    abortRef.current = true;
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
      case 'blue': return 'border-l-verdict-blue bg-verdict-blue-bg/30';
      default: return '';
    }
  };

  const getSectionIcon = (type?: string) => {
    switch (type) {
      case 'chapter': return '📚';
      case 'section': return '📖';
      case 'subsection': return '📄';
      default: return '¶';
    }
  };

  const checkedCount = paragraphs.filter(p => p.checked).length;
  const checkableParagraphCount = paragraphs.filter(p => p.shouldCheck !== false).length;
  const greenCount = paragraphs.filter(p => p.result?.overall_color === 'green').length;
  const yellowCount = paragraphs.filter(p => p.result?.overall_color === 'yellow').length;
  const redCount = paragraphs.filter(p => p.result?.overall_color === 'red').length;
  const blueCount = paragraphs.filter(p => p.result?.overall_color === 'blue').length;

  const startNewSession = () => {
    setFile(null);
    setParagraphs([]);
    setSelectedIndex(null);
    setCurrentSessionId(null);
    setCitationAnalysis(null);
    setFullText('');
  };

  const missingSources = citationAnalysis ? getMissingSources(citationAnalysis) : [];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header with thesis info */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-primary" />
          <div>
            <h2 className="scholarly-heading text-2xl font-bold">Copilot Mode</h2>
            <p className="text-sm text-muted-foreground">
              {file ? (
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-muted-foreground">• {paragraphs.length} sections</span>
                </span>
              ) : (
                "Parse your thesis and check paragraphs interactively"
              )}
            </p>
          </div>
        </div>
        
        {file && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowStructure(!showStructure)}
            >
              {showStructure ? <List className="h-4 w-4 mr-1" /> : <FolderOpen className="h-4 w-4 mr-1" />}
              {showStructure ? 'List View' : 'Structure View'}
            </Button>
          </div>
        )}
      </div>

      {/* Session Selector - always visible */}
      {sessions.length > 0 && (
        <Card className="p-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-muted-foreground" />
              <span className="font-medium">Previous Sessions</span>
            </div>
            <Select
              value={currentSessionId || ""}
              onValueChange={(value) => {
                const session = sessions.find(s => s.id === value);
                if (session) loadSession(session);
              }}
            >
              <SelectTrigger className="w-[300px]">
                <SelectValue placeholder="Select a previous session..." />
              </SelectTrigger>
              <SelectContent>
                {sessions.map(session => (
                  <SelectItem key={session.id} value={session.id}>
                    <div className="flex items-center justify-between gap-2 w-full">
                      <span className="truncate">{session.thesis_name}</span>
                      <Badge variant="secondary" className="ml-2">
                        {session.checked_paragraphs}/{session.total_paragraphs}
                      </Badge>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {currentSessionId && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete session?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this session and all its data.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => deleteSession(currentSessionId)}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            
            <Button variant="outline" size="sm" onClick={startNewSession}>
              New Session
            </Button>
          </div>
        </Card>
      )}

      {/* Missing Sources Alert */}
      {citationAnalysis && missingSources.length > 0 && (
        <Card className="p-4 border-destructive bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <h4 className="font-semibold text-destructive">
                {missingSources.length} Missing Source{missingSources.length > 1 ? 's' : ''} in Library
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                The following citations were found in your thesis but are not in your source library:
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {missingSources.map((citation, i) => (
                  <Badge key={i} variant="outline" className="text-destructive border-destructive">
                    {citation.raw}
                    {citation.count > 1 && <span className="ml-1 opacity-60">×{citation.count}</span>}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Add these sources to your library for accurate verification.
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Citation Summary */}
      {citationAnalysis && citationAnalysis.totalCitations > 0 && missingSources.length === 0 && (
        <Card className="p-4 border-verdict-green bg-verdict-green-bg/30">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-verdict-green" />
            <div>
              <span className="font-medium text-verdict-green">
                All {citationAnalysis.totalCitations} citations matched!
              </span>
              <span className="text-sm text-muted-foreground ml-2">
                Your source library covers all detected citations.
              </span>
            </div>
          </div>
        </Card>
      )}

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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{checkableParagraphCount} to check</Badge>
                <Badge variant="secondary">{blueCount} skipped</Badge>
              </div>
              <div className="flex gap-2">
                {!isBatchChecking ? (
                  <Button 
                    variant="default" 
                    size="sm" 
                    onClick={startBatchCheck}
                    disabled={paragraphs.filter(p => !p.checked && p.shouldCheck !== false).length === 0 || sources.length === 0}
                  >
                    <Play className="h-4 w-4 mr-1" />
                    Check All ({paragraphs.filter(p => !p.checked && p.shouldCheck !== false).length})
                  </Button>
                ) : (
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    onClick={stopBatchCheck}
                  >
                    <Square className="h-4 w-4 mr-1" />
                    Stop
                  </Button>
                )}
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={startNewSession}
                >
                  Change File
                </Button>
              </div>
            </div>

            {/* Progress and Stats */}
            {checkedCount > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>{checkedCount - blueCount} verified</span>
                  <div className="flex gap-3">
                    {greenCount > 0 && <span className="text-verdict-green">{greenCount} ✓</span>}
                    {yellowCount > 0 && <span className="text-verdict-yellow">{yellowCount} ⚠</span>}
                    {redCount > 0 && <span className="text-verdict-red">{redCount} ✗</span>}
                    {blueCount > 0 && <span className="text-verdict-blue">{blueCount} ○</span>}
                  </div>
                </div>
                {isBatchChecking && (
                  <Progress value={batchProgress} className="h-2" />
                )}
              </div>
            )}

            <ScrollArea className="h-[550px] border rounded-lg">
              <div className="p-2 space-y-1">
                {paragraphs.map((p, i) => {
                  const isSection = p.sectionType === 'chapter' || p.sectionType === 'section';
                  
                  return (
                    <Card
                      key={i}
                      className={cn(
                        "p-3 cursor-pointer transition-all hover:shadow-md border-l-4",
                        selectedIndex === i && "ring-2 ring-primary",
                        p.checked ? getColorClass(p.result) : "border-l-transparent",
                        isSection && "bg-secondary/30",
                      )}
                      onClick={() => setSelectedIndex(i)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs">{getSectionIcon(p.sectionType)}</span>
                            {isSection ? (
                              <span className="text-xs font-semibold text-primary uppercase">
                                {p.sectionType}
                              </span>
                            ) : (
                              <span className="text-xs font-medium text-muted-foreground">
                                ¶{i + 1}
                              </span>
                            )}
                            {p.checked && p.result && (
                              <VerdictBadge color={p.result.overall_color} size="sm" />
                            )}
                          </div>
                          <p className={cn(
                            "text-sm",
                            isSection ? "font-semibold line-clamp-1" : "line-clamp-2"
                          )}>
                            {p.text}
                          </p>
                        </div>
                        {p.shouldCheck !== false && (
                          <Button
                            variant={p.checked ? "outline" : "default"}
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); checkParagraph(i); }}
                            disabled={(isChecking && selectedIndex === i) || isBatchChecking}
                            className="shrink-0"
                          >
                            {isChecking && selectedIndex === i ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : p.checked ? (
                              <CheckCircle2 className="h-4 w-4" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* Right: Results */}
          <div className="space-y-4">
            {selectedParagraph && (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">
                      {selectedParagraph.sectionType === 'chapter' || selectedParagraph.sectionType === 'section' 
                        ? `${selectedParagraph.sectionType.charAt(0).toUpperCase() + selectedParagraph.sectionType.slice(1)}: `
                        : `Paragraph ${selectedIndex! + 1} of ${paragraphs.length}`
                      }
                    </span>
                  </div>
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
                <Card className="p-4 bg-secondary/30 max-h-[200px] overflow-y-auto">
                  <p className="text-sm whitespace-pre-wrap">{selectedParagraph.text}</p>
                </Card>

                {/* Result or prompt to check */}
                {selectedParagraph.checked && selectedParagraph.result ? (
                  <CheckResult 
                    result={selectedParagraph.result} 
                    paragraphText={selectedParagraph.text}
                    sources={sources}
                  />
                ) : selectedParagraph.shouldCheck !== false ? (
                  <Card className="p-8 text-center">
                    <Sparkles className="h-8 w-8 mx-auto text-primary mb-2" />
                    <p className="text-muted-foreground">Click "Check" to analyze this paragraph</p>
                  </Card>
                ) : (
                  <Card className="p-8 text-center">
                    <p className="text-muted-foreground">This section does not require verification</p>
                  </Card>
                )}
              </>
            )}

            {!selectedParagraph && (
              <Card className="p-12 text-center">
                <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-muted-foreground">Select a paragraph to view details</p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}