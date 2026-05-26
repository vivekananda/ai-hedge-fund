import React, { useState, useEffect, ReactNode } from 'react';
import { History, Loader2, Trash2, AlertCircle, RefreshCw, Layers } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useNodeContext } from '@/contexts/node-context';
import { api, SimulationRunMetadata } from '@/services/api';
import { ComponentGroup, getComponentGroups } from '@/data/sidebar-components';
import { useComponentGroups } from '@/hooks/use-component-groups';
import { useResizable } from '@/hooks/use-resizable';
import { cn } from '@/lib/utils';
import { ComponentActions } from './component-actions';
import { ComponentList } from './component-list';

interface RightSidebarProps {
  children?: ReactNode;
  isCollapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onWidthChange?: (width: number) => void;
}

export function RightSidebar({
  isCollapsed,
  onWidthChange,
}: RightSidebarProps) {
  const [activeRightTab, setActiveRightTab] = useState<'components' | 'history'>('components');

  // Resize logic
  const { width, isDragging, elementRef, startResize } = useResizable({
    defaultWidth: 280,
    minWidth: 200,
    maxWidth: window.innerWidth * .90,
    side: 'right',
  });

  useEffect(() => {
    onWidthChange?.(width);
  }, [width, onWidthChange]);

  // Components state
  const [componentGroups, setComponentGroups] = useState<ComponentGroup[]>([]);
  const [isComponentsLoading, setIsComponentsLoading] = useState(true);

  useEffect(() => {
    const loadComponentGroups = async () => {
      try {
        setIsComponentsLoading(true);
        const groups = await getComponentGroups();
        setComponentGroups(groups);
      } catch (error) {
        console.error('Failed to load component groups:', error);
      } finally {
        setIsComponentsLoading(false);
      }
    };
    loadComponentGroups();
  }, []);

  const {
    searchQuery,
    setSearchQuery,
    activeItem,
    openGroups,
    filteredGroups,
    handleAccordionChange,
  } = useComponentGroups(componentGroups);

  // History state
  const [runs, setRuns] = useState<SimulationRunMetadata[]>([]);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const nodeContext = useNodeContext();

  const fetchHistory = async () => {
    try {
      setIsHistoryLoading(true);
      setHistoryError(null);
      const data = await api.getSimulationRuns();
      setRuns(data);
    } catch (err) {
      console.error('Error fetching simulation history:', err);
      setHistoryError('Failed to load history');
    } finally {
      setIsHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (activeRightTab === 'history') {
      fetchHistory();
    }
  }, [activeRightTab]);

  const handleLoadRun = async (runId: string) => {
    try {
      setLoadingRunId(runId);
      const detail = await api.getSimulationRun(runId);
      
      // Load details into node context to restore Flow state
      nodeContext.loadPastRun(
        detail.logs || [],
        detail.decisions,
        detail.analyst_signals
      );
    } catch (err) {
      console.error('Error loading simulation run details:', err);
      alert('Failed to load this simulation run.');
    } finally {
      setLoadingRunId(null);
    }
  };

  const handleDeleteRun = async (e: React.MouseEvent, runId: string) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this run from cache?')) return;
    
    try {
      await api.deleteSimulationRun(runId);
      setRuns(prev => prev.filter(r => r.id !== runId));
    } catch (err) {
      console.error('Error deleting simulation run:', err);
      alert('Failed to delete this simulation run.');
    }
  };

  const formatRelativeTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) return 'Just now';
      if (diffMins < 60) return `${diffMins}m ago`;
      
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}h ago`;
      
      return date.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
      });
    } catch (e) {
      return '';
    }
  };

  return (
    <div 
      ref={elementRef}
      className={cn(
        "h-full bg-panel flex flex-col relative pt-2 border-l",
        isCollapsed ? "shadow-lg" : "",
      )}
      style={{ 
        width: `${width}px`
      }}
    >
      {/* Sidebar Tab Header */}
      <div className="flex border-b border-ramp-grey-800 px-2 bg-panel flex-shrink-0">
        <button
          onClick={() => setActiveRightTab('components')}
          className={cn(
            "flex-1 py-2 text-xs font-semibold text-center border-b-2 transition-all flex items-center justify-center gap-1.5",
            activeRightTab === 'components'
              ? "border-cyan-500 text-white"
              : "border-transparent text-gray-400 hover:text-white"
          )}
        >
          <Layers className="h-3 w-3" />
          Components
        </button>
        <button
          onClick={() => setActiveRightTab('history')}
          className={cn(
            "flex-1 py-2 text-xs font-semibold text-center border-b-2 transition-all flex items-center justify-center gap-1.5",
            activeRightTab === 'history'
              ? "border-cyan-500 text-white"
              : "border-transparent text-gray-400 hover:text-white"
          )}
        >
          <History className="h-3 w-3" />
          History
        </button>
      </div>

      {/* Tab Contents */}
      {activeRightTab === 'components' ? (
        <div className="flex-grow flex flex-col min-h-0">
          <ComponentActions />
          <ComponentList
            componentGroups={componentGroups}
            searchQuery={searchQuery}
            isLoading={isComponentsLoading}
            openGroups={openGroups}
            filteredGroups={filteredGroups}
            activeItem={activeItem}
            onSearchChange={setSearchQuery}
            onAccordionChange={handleAccordionChange}
          />
        </div>
      ) : (
        <div className="flex-grow flex flex-col min-h-0">
          {/* History Header Controls */}
          <div className="p-3 flex justify-between items-center border-b border-ramp-grey-800 flex-shrink-0">
            <span className="text-muted-foreground text-xs font-medium">
              Simulation Runs
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={fetchHistory}
              className="h-6 w-6 text-gray-400 hover:text-white hover:bg-ramp-grey-800"
              title="Refresh History"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isHistoryLoading && "animate-spin")} />
            </Button>
          </div>

          {/* History Content */}
          <div className="flex-grow overflow-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-ramp-grey-700">
            {isHistoryLoading && runs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
                <span className="text-xs text-gray-400">Loading history...</span>
              </div>
            ) : historyError ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-center text-red-400">
                <AlertCircle className="h-5 w-5 text-red-500" />
                <span className="text-xs">{historyError}</span>
              </div>
            ) : runs.length === 0 ? (
              <div className="text-center py-10 text-xs text-gray-500">
                No cached simulation runs. Run a simulation in the workspace!
              </div>
            ) : (
              runs.map((run) => {
                const isCompleted = run.status === 'COMPLETE';
                const isFailed = run.status === 'ERROR';
                
                return (
                  <Card 
                    key={run.id}
                    onClick={() => handleLoadRun(run.id)}
                    className={cn(
                      "bg-ramp-grey-950 border-ramp-grey-850 hover:border-cyan-500/40 cursor-pointer transition-all duration-200 text-white group",
                      loadingRunId === run.id && "ring-1 ring-cyan-500/50"
                    )}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex justify-between items-start">
                        <span className="text-[10px] text-gray-400 font-semibold">
                          {formatRelativeTime(run.created_at)}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            isCompleted ? "bg-emerald-500" :
                            isFailed ? "bg-red-500" : "bg-cyan-500 animate-pulse"
                          )} />
                          <button
                            onClick={(e) => handleDeleteRun(e, run.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-gray-500 hover:text-red-400 rounded hover:bg-ramp-grey-850"
                            title="Delete Run"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Tickers */}
                      <div className="text-xs font-bold truncate text-white" title={run.tickers.join(', ')}>
                        {run.tickers.join(', ')}
                      </div>

                      {/* Run Metadata */}
                      <div className="flex flex-col gap-0.5 text-[9px] text-gray-400">
                        <div className="flex justify-between">
                          <span>Model:</span>
                          <span className="text-gray-300 truncate max-w-[100px]">{run.model_name}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Agents:</span>
                          <span className="text-gray-300">{run.selected_agents.length} active</span>
                        </div>
                      </div>

                      {/* Load Progress Loader */}
                      {loadingRunId === run.id && (
                        <div className="flex items-center gap-1.5 text-[9px] text-cyan-400 pt-1 border-t border-ramp-grey-800">
                          <Loader2 className="h-3 w-3 animate-spin" />
                          Restoring Workspace State...
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      )}
      
      {/* Resize handle - on the left side for right sidebar */}
      {!isDragging && (
        <div 
          className="absolute top-0 left-0 h-full w-1 cursor-ew-resize transition-all duration-150 z-10"
          onMouseDown={startResize}
        />
      )}
    </div>
  );
}
