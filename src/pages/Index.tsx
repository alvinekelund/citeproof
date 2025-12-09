import { useState, useCallback } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuditParagraph } from "@/components/audit/AuditParagraph";
import { CopilotMode, UnmatchedCitation } from "@/components/audit/CopilotMode";
import { SourceLibrary } from "@/components/sources/SourceLibrary";
import { HistoryView } from "@/components/history/HistoryView";

const Index = () => {
  const [activeTab, setActiveTab] = useState<'audit' | 'copilot' | 'library' | 'history'>('copilot');
  const [sourceRefreshKey, setSourceRefreshKey] = useState(0);
  const [usedSourceIds, setUsedSourceIds] = useState<Set<string>>(new Set());
  const [unmatchedCitations, setUnmatchedCitations] = useState<UnmatchedCitation[]>([]);

  // Callback to trigger source refresh when switching tabs
  const handleTabChange = useCallback((tab: 'audit' | 'copilot' | 'library' | 'history') => {
    setActiveTab(tab);
    // Increment key to trigger refresh in copilot when coming back to it
    if (tab === 'copilot') {
      setSourceRefreshKey(k => k + 1);
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

  return (
    <AppLayout activeTab={activeTab} onTabChange={handleTabChange}>
      {activeTab === 'audit' && <AuditParagraph />}
      {activeTab === 'copilot' && (
        <CopilotMode 
          key={sourceRefreshKey} 
          onSourcesChange={() => setSourceRefreshKey(k => k + 1)}
          onUsedSourcesChange={setUsedSourceIds}
          onUnmatchedCitationsChange={setUnmatchedCitations}
        />
      )}
      {activeTab === 'library' && (
        <SourceLibrary 
          usedSourceIds={usedSourceIds} 
          unmatchedCitations={unmatchedCitations}
          onSourcesUpdated={() => setSourceRefreshKey(k => k + 1)}
          onLinkCitation={handleLinkCitation}
          onToggleSourceStatus={handleToggleStatus}
        />
      )}
      {activeTab === 'history' && <HistoryView />}
    </AppLayout>
  );
};

export default Index;
