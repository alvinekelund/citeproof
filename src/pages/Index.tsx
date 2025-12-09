import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { AuditParagraph } from "@/components/audit/AuditParagraph";
import { SourceLibrary } from "@/components/sources/SourceLibrary";
import { HistoryView } from "@/components/history/HistoryView";

const Index = () => {
  const [activeTab, setActiveTab] = useState<'audit' | 'library' | 'history'>('audit');

  return (
    <AppLayout activeTab={activeTab} onTabChange={setActiveTab}>
      {activeTab === 'audit' && <AuditParagraph />}
      {activeTab === 'library' && <SourceLibrary />}
      {activeTab === 'history' && <HistoryView />}
    </AppLayout>
  );
};

export default Index;
