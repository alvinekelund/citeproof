import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuditParagraph } from "@/components/audit/AuditParagraph";
import { CopilotMode } from "@/components/audit/CopilotMode";
import { SourceLibrary } from "@/components/sources/SourceLibrary";
import { HistoryView } from "@/components/history/HistoryView";

const Index = () => {
  const [activeTab, setActiveTab] = useState<'audit' | 'copilot' | 'library' | 'history'>('copilot');

  return (
    <AppLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'audit' && <AuditParagraph />}
      {activeTab === 'copilot' && <CopilotMode />}
      {activeTab === 'library' && <SourceLibrary />}
      {activeTab === 'history' && <HistoryView />}
    </AppLayout>
  );
};

export default Index;
