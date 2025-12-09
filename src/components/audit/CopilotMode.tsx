import { useState, useCallback, useEffect, useRef } from "react";
import { Upload, FileText, Loader2, ChevronLeft, ChevronRight, Sparkles, BookOpen, Play, Square, CheckCircle2, FolderOpen, List, History, Trash2, AlertCircle, RefreshCw, CircleSlash, X, ChevronDown, ChevronUp, Link2 } from "lucide-react";
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
import { getSources, createParagraphCheck, addPendingCitation, clearPendingCitations, saveSessionMissingData, getSessionMissingData, deleteSessionMissingData } from "@/lib/client-storage";
import { supabase } from "@/integrations/supabase/client";
import { analyzeCitations, CitationAnalysis, getMissingSources, parseCitationForPlaceholder, deduplicateCitations } from "@/lib/citation-detector";
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

interface CopilotModeProps {
  onSourcesChange?: () => void;
  onUsedSourcesChange?: (usedIds: Set<string>) => void;
}

export function CopilotMode({ onSourcesChange, onUsedSourcesChange }: CopilotModeProps) {
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
  const [dismissedCitations, setDismissedCitations] = useState<Set<string>>(new Set());
  const [missingSourcesCollapsed, setMissingSourcesCollapsed] = useState(false);
  const [selectedForMerge, setSelectedForMerge] = useState<Set<string>>(new Set());

  // Helper to analyze and deduplicate citations
  const analyzeAndDeduplicateCitations = useCallback(async (text: string, currentSources: Source[]) => {
    const analysis = analyzeCitations(text, currentSources);
    // Run AI deduplication on the results
    const dedupedAnalysis = await deduplicateCitations(analysis);
    return dedupedAnalysis;
  }, []);

  // Refresh sources and re-analyze citations
  const refreshSourcesAndCitations = useCallback(async () => {
    const currentSources = getSources();
    setSources(currentSources);
    
    // Re-analyze citations if we have full text
    if (fullText) {
      const analysis = await analyzeAndDeduplicateCitations(fullText, currentSources);
      setCitationAnalysis(analysis);
      
      // Report used source IDs to parent
      if (onUsedSourcesChange) {
        const usedIds = new Set<string>(
          analysis.detectedCitations
            .filter(c => c.matched && c.matchedSourceId)
            .map(c => c.matchedSourceId!)
        );
        onUsedSourcesChange(usedIds);
      }
    }
  }, [fullText, onUsedSourcesChange, analyzeAndDeduplicateCitations]);

  // Load sources and sessions on mount - auto-load most recent session
  useEffect(() => {
    setSources(getSources());
    loadSessions(true); // Auto-load most recent session
  }, []);

  const loadSessions = async (autoLoadMostRecent = false) => {
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
      })) as CopilotSession[];
      
      setSessions(parsedSessions);
      
      // Auto-load most recent session if requested and no session is currently loaded
      if (autoLoadMostRecent && parsedSessions.length > 0 && !currentSessionId && !file) {
        const mostRecent = parsedSessions[0];
        loadSessionData(mostRecent);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setLoadingSessions(false);
    }
  };
  
  // Helper to load session data without triggering toast (for auto-load)
  const loadSessionData = async (session: CopilotSession, showToast = false) => {
    setCurrentSessionId(session.id);
    setParagraphs(session.paragraphs_data);
    setFile({ name: session.thesis_name } as File);
    setSelectedIndex(null);
    
    // Restore fullText and re-analyze citations against current library
    const sessionData = getSessionMissingData(session.id);
    if (sessionData?.fullText) {
      setFullText(sessionData.fullText);
      const currentSources = getSources();
      const analysis = await analyzeAndDeduplicateCitations(sessionData.fullText, currentSources);
      setCitationAnalysis(analysis);
      
      // Report used source IDs to parent
      if (onUsedSourcesChange) {
        const usedIds = new Set<string>(
          analysis.detectedCitations
            .filter(c => c.matched && c.matchedSourceId)
            .map(c => c.matchedSourceId!)
        );
        onUsedSourcesChange(usedIds);
      }
    } else {
      setFullText('');
      setCitationAnalysis(null);
      if (onUsedSourcesChange) {
        onUsedSourcesChange(new Set());
      }
    }
    
    if (showToast) {
      toast({ title: "Session loaded", description: `Loaded "${session.thesis_name}"` });
    }
  };

  const saveSession = async (thesisName: string, paragraphsData: ParagraphData[], textContent?: string): Promise<string | null> => {
    const checkedCount = paragraphsData.filter(p => p.checked).length;
    
    try {
      let sessionId = currentSessionId;
      
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
        sessionId = data.id;
        setCurrentSessionId(data.id);
      }
      
      // Save full text for citation re-analysis when session is loaded
      if (sessionId && textContent) {
        saveSessionMissingData({ sessionId, fullText: textContent });
      }
      
      // Refresh sessions list
      loadSessions();
      return sessionId;
    } catch (error) {
      console.error('Failed to save session:', error);
      return null;
    }
  };

  const loadSession = (session: CopilotSession) => {
    loadSessionData(session, true);
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
        setCitationAnalysis(null);
        setFullText('');
      }
      
      // Also delete session missing data
      deleteSessionMissingData(sessionId);
      
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
      
      // Analyze citations against sources (with AI deduplication)
      const currentSources = getSources();
      const analysis = await analyzeAndDeduplicateCitations(text, currentSources);
      setCitationAnalysis(analysis);
      
      // Report used source IDs to parent
      if (onUsedSourcesChange) {
        const usedIds = new Set<string>(
          analysis.detectedCitations
            .filter(c => c.matched && c.matchedSourceId)
            .map(c => c.matchedSourceId!)
        );
        onUsedSourcesChange(usedIds);
      }
      
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
      
      // Save new session with full text for citation persistence
      await saveSession(uploadedFile.name, newParagraphs, text);

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

      if (error) {
        // Check for specific error codes
        const errorMessage = error.message || '';
        if (errorMessage.includes('402') || errorMessage.includes('credits')) {
          toast({ 
            title: "AI Credits Exhausted", 
            description: "Please add credits in Settings → Workspace → Usage", 
            variant: "destructive" 
          });
          return false;
        }
        if (errorMessage.includes('429') || errorMessage.includes('rate')) {
          toast({ 
            title: "Rate Limited", 
            description: "Too many requests. Please wait a moment and try again.", 
            variant: "destructive" 
          });
          return false;
        }
        throw error;
      }

      if (data.error) {
        // Check for specific errors in response
        if (data.error.includes('402') || data.error.toLowerCase().includes('credit')) {
          toast({ 
            title: "AI Credits Exhausted", 
            description: "Please add credits in Settings → Workspace → Usage", 
            variant: "destructive" 
          });
          return false;
        }
        if (data.error.includes('429') || data.error.toLowerCase().includes('rate')) {
          toast({ 
            title: "Rate Limited", 
            description: "Too many requests. Please wait a moment and try again.", 
            variant: "destructive" 
          });
          return false;
        }
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
      const msg = error?.message || '';
      if (msg.includes('402')) {
        toast({ title: "AI Credits Exhausted", description: "Add credits in Settings → Workspace → Usage", variant: "destructive" });
      } else if (msg.includes('429')) {
        toast({ title: "Rate Limited", description: "Please wait and try again", variant: "destructive" });
      } else {
        toast({ title: "Failed to run check", description: msg, variant: "destructive" });
      }
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
        
        // Longer delay between requests to avoid rate limiting
        await new Promise(r => setTimeout(r, 2500));
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

  const markAsBlue = async (index: number) => {
    const paragraph = paragraphs[index];
    if (!paragraph) return;
    
    const blueResult = {
      summary: 'Manually marked as not requiring citation verification.',
      overall_color: 'blue' as const,
      claims: [],
      missing_or_ambiguous_citations: [],
    };
    
    const newParagraphs = paragraphs.map((p, i) => 
      i === index ? { ...p, checked: true, shouldCheck: false, result: blueResult } : p
    );
    setParagraphs(newParagraphs);
    
    if (file) {
      await saveSession(file.name, newParagraphs);
    }
    
    toast({ title: "Marked as no source needed" });
  };

  const missingSources = citationAnalysis 
    ? getMissingSources(citationAnalysis).filter(c => !dismissedCitations.has(c.normalized))
    : [];

  const dismissCitation = (normalized: string) => {
    setDismissedCitations(prev => new Set([...prev, normalized]));
    setSelectedForMerge(prev => {
      const next = new Set(prev);
      next.delete(normalized);
      return next;
    });
    toast({ title: "Citation dismissed" });
  };

  const toggleMergeSelection = (normalized: string) => {
    setSelectedForMerge(prev => {
      const next = new Set(prev);
      if (next.has(normalized)) {
        next.delete(normalized);
      } else {
        next.add(normalized);
      }
      return next;
    });
  };

  const mergeCitations = () => {
    if (selectedForMerge.size < 2 || !citationAnalysis) return;
    
    const toMerge = citationAnalysis.detectedCitations.filter(c => selectedForMerge.has(c.normalized));
    if (toMerge.length < 2) return;
    
    // Pick canonical form: prefer parenthetical, then longest
    const sorted = [...toMerge].sort((a, b) => {
      const aParens = a.raw.startsWith('(');
      const bParens = b.raw.startsWith('(');
      if (aParens !== bParens) return aParens ? -1 : 1;
      return b.raw.length - a.raw.length;
    });
    
    const canonical = sorted[0];
    const totalCount = toMerge.reduce((sum, c) => sum + c.count, 0);
    
    // Create merged citation and filter out others
    const mergedNormalized = new Set(toMerge.map(c => c.normalized));
    const otherCitations = citationAnalysis.detectedCitations.filter(c => !mergedNormalized.has(c.normalized));
    
    const mergedCitation = {
      ...canonical,
      count: totalCount,
    };
    
    const newCitations = [...otherCitations, mergedCitation].sort((a, b) => b.count - a.count);
    const matchedCount = newCitations.filter(c => c.matched).length;
    
    setCitationAnalysis({
      detectedCitations: newCitations,
      matchedCount,
      missingCount: newCitations.length - matchedCount,
      totalCitations: newCitations.length,
    });
    
    // Clear selection and dismiss the merged-away citations
    const mergedAwayNormalized = toMerge.filter(c => c.normalized !== canonical.normalized).map(c => c.normalized);
    setDismissedCitations(prev => new Set([...prev, ...mergedAwayNormalized]));
    setSelectedForMerge(new Set());
    
    toast({ 
      title: "Citations merged", 
      description: `${toMerge.length} citations merged into "${canonical.raw}"` 
    });
  };

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

      {/* Missing Sources Alert with Re-analyze button */}
      {citationAnalysis && missingSources.length > 0 && (
        <Card className="p-4 border-destructive bg-destructive/5">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <button 
                  onClick={() => setMissingSourcesCollapsed(!missingSourcesCollapsed)}
                  className="flex items-center gap-1 font-semibold text-destructive hover:underline"
                >
                  {missingSourcesCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  {missingSources.length} Missing Source{missingSources.length > 1 ? 's' : ''} in Library
                </button>
                <div className="flex gap-2 flex-wrap">
                  {selectedForMerge.size >= 2 && (
                    <Button 
                      variant="default" 
                      size="sm"
                      onClick={mergeCitations}
                    >
                      <Link2 className="h-4 w-4 mr-1" />
                      Merge {selectedForMerge.size} Selected
                    </Button>
                  )}
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={refreshSourcesAndCitations}
                  >
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Re-analyze
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => {
                      clearPendingCitations();
                      for (const citation of missingSources) {
                        const parsed = parseCitationForPlaceholder(citation.raw);
                        addPendingCitation({
                          label: parsed.label,
                          author: parsed.author,
                          year: parsed.year,
                          count: citation.count,
                        });
                      }
                      setMissingSourcesCollapsed(true);
                      toast({ 
                        title: "Citations ready for matching", 
                        description: `${missingSources.length} citations added. Now upload PDFs to your library - they'll be auto-matched.` 
                      });
                    }}
                  >
                    Queue All for Matching
                  </Button>
                </div>
              </div>
              
              {!missingSourcesCollapsed && (
                <>
                  <p className="text-sm text-muted-foreground mt-1">
                    Click to queue for matching, or select multiple and merge duplicates:
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {missingSources.map((citation, i) => {
                      const parsed = parseCitationForPlaceholder(citation.raw);
                      const isSelected = selectedForMerge.has(citation.normalized);
                      return (
                        <Badge 
                          key={i} 
                          variant="outline" 
                          className={cn(
                            "cursor-pointer transition-colors group pr-1",
                            isSelected 
                              ? "bg-primary text-primary-foreground border-primary" 
                              : "text-destructive border-destructive hover:bg-destructive/10"
                          )}
                          onClick={() => {
                            addPendingCitation({
                              label: parsed.label,
                              author: parsed.author,
                              year: parsed.year,
                              count: citation.count,
                            });
                            toast({ 
                              title: "Citation queued", 
                              description: `"${citation.raw}" is ready for matching. Upload the PDF to your library.` 
                            });
                          }}
                        >
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleMergeSelection(citation.normalized);
                            }}
                            className={cn(
                              "mr-1 p-0.5 rounded transition-all",
                              isSelected 
                                ? "bg-primary-foreground/20" 
                                : "opacity-50 group-hover:opacity-100 hover:bg-destructive/20"
                            )}
                            title={isSelected ? "Deselect for merge" : "Select for merge"}
                          >
                            <Link2 className="h-3 w-3" />
                          </button>
                          {citation.raw}
                          {citation.count > 1 && <span className="ml-1 opacity-60">×{citation.count}</span>}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              dismissCitation(citation.normalized);
                            }}
                            className={cn(
                              "ml-1 p-0.5 rounded transition-opacity",
                              isSelected 
                                ? "hover:bg-primary-foreground/20 opacity-70 group-hover:opacity-100" 
                                : "hover:bg-destructive/20 opacity-50 group-hover:opacity-100"
                            )}
                            title="Dismiss citation"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      );
                    })}
                  </div>
                  {selectedForMerge.size > 0 && selectedForMerge.size < 2 && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Select at least 2 citations to merge them together
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-3">
                    Go to Sources tab to upload PDFs. They'll automatically be matched to queued citations.
                  </p>
                </>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Citation Summary with Re-analyze button */}
      {citationAnalysis && citationAnalysis.totalCitations > 0 && missingSources.length === 0 && (
        <Card className="p-4 border-verdict-green bg-verdict-green-bg/30">
          <div className="flex items-center justify-between gap-3">
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
            <Button variant="outline" size="sm" onClick={refreshSourcesAndCitations}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Re-analyze
            </Button>
          </div>
        </Card>
      )}

      {/* Re-analyze button when no citations detected */}
      {fullText && (!citationAnalysis || citationAnalysis.totalCitations === 0) && (
        <Card className="p-4 bg-secondary/30">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">No citations detected or analysis not run</span>
            <Button variant="outline" size="sm" onClick={refreshSourcesAndCitations}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Analyze Citations
            </Button>
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
                  <Card className="p-8 text-center space-y-4">
                    <Sparkles className="h-8 w-8 mx-auto text-primary" />
                    <p className="text-muted-foreground">Click "Check" to analyze this paragraph</p>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => selectedIndex !== null && markAsBlue(selectedIndex)}
                    >
                      <CircleSlash className="h-4 w-4 mr-1" />
                      Mark as No Source Needed
                    </Button>
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