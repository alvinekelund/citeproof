import { useState, useCallback, useRef } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { CopilotMode, UnmatchedCitation, CopilotModeHandle } from "@/components/audit/CopilotMode";
import { SourceLibrary } from "@/components/sources/SourceLibrary";
import { HistoryView } from "@/components/history/HistoryView";

const Index = () => {
  const [activeTab, setActiveTab] = useState<'copilot' | 'library' | 'history'>('copilot');
  const [usedSourceIds, setUsedSourceIds] = useState<Set<string>>(new Set());
  const [unmatchedCitations, setUnmatchedCitations] = useState<UnmatchedCitation[]>([]);
  const copilotRef = useRef<CopilotModeHandle>(null);

  // Callback to trigger source refresh when switching tabs
  const handleTabChange = useCallback((tab: 'copilot' | 'library' | 'history') => {
    setActiveTab(tab);
    // Trigger a sources refresh in copilot when coming back to it
    if (tab === 'copilot') {
      copilotRef.current?.refreshSources();
    }
  }, []);

  // Handle linking a citation to a source - update state immediately
  const handleLinkCitation = useCallback((sourceId: string, citationLabel: string) => {
    // Add source to used set
    setUsedSourceIds(prev => {
      const next = new Set(prev);
      next.add(sourceId);
      return next;
    });
    // Remove citation from unmatched list
    setUnmatchedCitations(prev => 
      prev.filter(c => c.label !== citationLabel)
    );
  }, []);

  // Handle toggling source status manually
  const handleToggleStatus = useCallback((sourceId: string, isUsed: boolean) => {
    setUsedSourceIds(prev => {
      const next = new Set(prev);
      if (isUsed) {
        next.add(sourceId);
      } else {
        next.delete(sourceId);
      }
      return next;
    });
  }, []);

  // Handle sources updated in library
  const handleSourcesUpdated = useCallback(() => {
    copilotRef.current?.refreshSources();
  }, []);

  return (
    <AppLayout activeTab={activeTab} onTabChange={handleTabChange}>
      {/* Keep CopilotMode always mounted but hidden to preserve state */}
      <div className={activeTab === 'copilot' ? '' : 'hidden'}>
        <CopilotMode 
          ref={copilotRef}
          onSourcesChange={handleSourcesUpdated}
          onUsedSourcesChange={setUsedSourceIds}
          onUnmatchedCitationsChange={setUnmatchedCitations}
        />
      </div>
      {activeTab === 'library' && (
        <SourceLibrary 
          usedSourceIds={usedSourceIds} 
          unmatchedCitations={unmatchedCitations}
          onSourcesUpdated={handleSourcesUpdated}
          onLinkCitation={handleLinkCitation}
          onToggleSourceStatus={handleToggleStatus}
        />
      )}
      {activeTab === 'history' && <HistoryView />}
    </AppLayout>
  );
};

export default Index;
