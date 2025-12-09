import { ReactNode } from "react";
import { BookOpen, Library, History, FileCheck, LogOut, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface AppLayoutProps {
  children: ReactNode;
  activeTab: 'audit' | 'copilot' | 'library' | 'history';
  onTabChange: (tab: 'audit' | 'copilot' | 'library' | 'history') => void;
}

const tabs = [
  { id: 'audit' as const, label: 'Audit', icon: FileCheck },
  { id: 'copilot' as const, label: 'Copilot', icon: Bot },
  { id: 'library' as const, label: 'Library', icon: Library },
  { id: 'history' as const, label: 'History', icon: History },
];

export function AppLayout({ children, activeTab, onTabChange }: AppLayoutProps) {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="container mx-auto px-4">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary">
                <BookOpen className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <h1 className="scholarly-heading text-xl font-bold">Thesis Source Checker</h1>
                <p className="text-xs text-muted-foreground">Academic verification assistant</p>
              </div>
            </div>
            
            {/* Navigation Tabs */}
            <nav className="flex items-center gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    className={cn(
                      "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                      activeTab === tab.id
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="hidden sm:inline">{tab.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* User Menu */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground hidden sm:inline">
                {user?.username}
              </span>
              <Button variant="ghost" size="sm" onClick={logout}>
                <LogOut className="h-4 w-4 mr-2" />
                <span className="hidden sm:inline">Logout</span>
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-6">
        {children}
      </main>
    </div>
  );
}
