import { SidebarProvider } from '@/components/ui/sidebar';
import { FlowProvider } from '@/contexts/flow-context';
import { cn } from '@/lib/utils';
import { ReactFlowProvider } from '@xyflow/react';
import { PanelLeft } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { LeftSidebar } from './sidebar/left-sidebar';
import { Button } from './ui/button';

type LayoutProps = {
  leftSidebar?: ReactNode;
  rightSidebar?: ReactNode;
  children: ReactNode;
  activeTab: 'simulation' | 'screener';
  onTabChange: (tab: 'simulation' | 'screener') => void;
};

export function Layout({ leftSidebar, rightSidebar, children, activeTab, onTabChange }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(true);

  return (
    <SidebarProvider defaultOpen={!isCollapsed}>
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-background">
        {/* Top Header Navigation */}
        <header className="flex items-center justify-between px-6 py-3 bg-ramp-grey-900 border-b border-ramp-grey-800 z-40 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-indigo-600 flex items-center justify-center font-bold text-white text-base shadow-lg shadow-indigo-500/10">
              Æ
            </div>
            <div className="flex flex-col">
              <span className="text-white font-bold tracking-wider text-xs leading-none">AI HEDGE FUND</span>
              <span className="text-[9px] text-cyan-400 font-medium tracking-widest mt-0.5">PORTFOLIO CO-PILOT</span>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 bg-ramp-grey-1000 p-1 rounded-lg border border-ramp-grey-800">
            <button
              onClick={() => onTabChange('simulation')}
              className={cn(
                "px-5 py-2 text-xs font-semibold rounded-md transition-all duration-200",
                activeTab === 'simulation' 
                  ? "bg-ramp-grey-800 text-white shadow-md border border-ramp-grey-700" 
                  : "text-gray-400 hover:text-white"
              )}
            >
              Simulation Workspace
            </button>
            <button
              onClick={() => onTabChange('screener')}
              className={cn(
                "px-5 py-2 text-xs font-semibold rounded-md transition-all duration-200",
                activeTab === 'screener' 
                  ? "bg-ramp-grey-800 text-white shadow-md border border-ramp-grey-700" 
                  : "text-gray-400 hover:text-white"
              )}
            >
              Market Screener
            </button>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>NIFTY 500 LIVE</span>
          </div>
        </header>

        {/* Workspace Body */}
        <div className="flex-1 flex overflow-hidden relative">
          <ReactFlowProvider>
            <FlowProvider>
              {/* Main content area takes full width */}
              <main className="flex-1 h-full overflow-hidden w-full relative">
                {children}
              </main>

              {/* Floating left sidebar - only render if simulation tab */}
              {activeTab === 'simulation' && (
                <div className={cn(
                  "absolute top-0 left-0 z-30 h-full transition-transform",
                  isCollapsed && "transform -translate-x-full opacity-0"
                )}>
                  <LeftSidebar
                    isCollapsed={isCollapsed}
                    onCollapse={() => setIsCollapsed(true)}
                    onExpand={() => setIsCollapsed(false)}
                    onToggleCollapse={() => setIsCollapsed(!isCollapsed)}
                  >
                    {leftSidebar}
                  </LeftSidebar>
                </div>
              )}

              {/* Sidebar toggle button - visible when sidebar is collapsed, only in simulation tab */}
              {isCollapsed && activeTab === 'simulation' && (
                <Button 
                  className="absolute top-4 left-4 z-30 bg-ramp-grey-800 text-white p-2 rounded-md hover:bg-ramp-grey-700 border border-ramp-grey-700 shadow-lg"
                  onClick={() => setIsCollapsed(false)}
                  aria-label="Show sidebar"
                >
                  Components <PanelLeft size={16} />
                </Button>
              )}

              {/* Right sidebar */}
              {rightSidebar && activeTab === 'simulation' && (
                <div className="h-full w-64 bg-gray-900 border-l border-gray-800 ml-auto flex-shrink-0">
                  {rightSidebar}
                </div>
              )}
            </FlowProvider>
          </ReactFlowProvider>
        </div>
      </div>
    </SidebarProvider>
  );
}