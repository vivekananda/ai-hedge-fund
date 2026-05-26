import { useFlowManagementTabs } from '@/hooks/use-flow-management-tabs';
import { useResizable } from '@/hooks/use-resizable';
import { cn } from '@/lib/utils';
import { ReactNode, useEffect } from 'react';
import { FlowActions } from './flow-actions';
import { FlowCreateDialog } from './flow-create-dialog';
import { FlowList } from './flow-list';
import { LineChart, Star } from 'lucide-react';

interface LeftSidebarProps {
  children?: ReactNode;
  isCollapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onWidthChange?: (width: number) => void;
  onOpenScreener?: () => void;
  onOpenWeeklyPicks?: () => void;
}

export function LeftSidebar({
  isCollapsed,
  onWidthChange,
  onOpenScreener,
  onOpenWeeklyPicks,
}: LeftSidebarProps) {
  // Use our custom hooks
  const { width, isDragging, elementRef, startResize } = useResizable({
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: window.innerWidth * .90,
    side: 'left',
  });

  // Notify parent component of width changes
  useEffect(() => {
    onWidthChange?.(width);
  }, [width, onWidthChange]);
  
  // Use flow management hook with tabs
  const {
    flows,
    searchQuery,
    isLoading,
    openGroups,
    createDialogOpen,
    filteredFlows,
    recentFlows,
    templateFlows,
    setSearchQuery,
    setCreateDialogOpen,
    handleAccordionChange,
    handleCreateNewFlow,
    handleFlowCreated,
    handleSaveCurrentFlow,
    handleOpenFlowInTab,
    handleDeleteFlow,
    handleRefresh,
  } = useFlowManagementTabs();

  return (
    <div 
      ref={elementRef}
      className={cn(
        "h-full bg-panel flex flex-col relative pt-5 border",
        isCollapsed ? "shadow-lg" : "",
      )}
      style={{ 
        width: `${width}px`
      }}
    >
      {/* Dashboards Section */}
      <div className="px-4 pb-4 mb-2 border-b flex flex-col gap-1">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
          Dashboards
        </span>
        <button
          onClick={onOpenScreener}
          className="group flex items-center gap-3 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150 text-muted-foreground hover:text-foreground hover:bg-ramp-grey-800 text-left"
        >
          <LineChart size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" />
          <span>Market Screener</span>
        </button>
        <button
          onClick={onOpenWeeklyPicks}
          className="group flex items-center gap-3 px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-150 text-muted-foreground hover:text-foreground hover:bg-ramp-grey-800 text-left"
        >
          <Star size={14} className="text-muted-foreground group-hover:text-foreground transition-colors" />
          <span>Weekly Picks</span>
        </button>
      </div>

      <FlowActions
        onSave={handleSaveCurrentFlow}
        onCreate={handleCreateNewFlow}
      />
      
      <FlowList
        flows={flows}
        searchQuery={searchQuery}
        isLoading={isLoading}
        openGroups={openGroups}
        filteredFlows={filteredFlows}
        recentFlows={recentFlows}
        templateFlows={templateFlows}
        onSearchChange={setSearchQuery}
        onAccordionChange={handleAccordionChange}
        onLoadFlow={handleOpenFlowInTab}
        onDeleteFlow={handleDeleteFlow}
        onRefresh={handleRefresh}
      />
      
      {/* Resize handle - on the right side for left sidebar */}
      {!isDragging && (
        <div 
          className="absolute top-0 right-0 h-full w-1 cursor-ew-resize transition-all duration-150 z-10"
          onMouseDown={startResize}
        />
      )}

      <FlowCreateDialog
        isOpen={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onFlowCreated={handleFlowCreated}
      />
    </div>
  );
} 