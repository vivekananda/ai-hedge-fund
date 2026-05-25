import React, { useState, useEffect } from 'react';
import { History, Loader2, Trash2, AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { useNodeContext } from '@/contexts/node-context';
import { api, SimulationRunMetadata } from '@/services/api';
import { cn } from '@/lib/utils';

export function RightSidebar() {
  const [runs, setRuns] = useState<SimulationRunMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingRunId, setLoadingRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nodeContext = useNodeContext();

  useEffect(() => {
    fetchHistory();
  }, []);

  const fetchHistory = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.getSimulationRuns();
      setRuns(data);
    } catch (err) {
      console.error('Error fetching simulation history:', err);
      setError('Failed to load history');
    } finally {
      setLoading(false);
    }
  };

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
    e.stopPropagation(); // Avoid triggering load
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
    <div className="h-full bg-ramp-grey-900 border-l border-ramp-grey-800 flex flex-col relative w-64">
      {/* Sidebar Header */}
      <div className="p-4 flex justify-between items-center border-b border-ramp-grey-800 flex-shrink-0">
        <span className="text-white text-sm font-semibold flex items-center gap-2">
          <History className="h-4 w-4 text-cyan-400" />
          Simulation History
        </span>
        <Button
          variant="ghost"
          size="icon"
          onClick={fetchHistory}
          className="h-6 w-6 text-gray-400 hover:text-white hover:bg-ramp-grey-800"
          title="Refresh History"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </Button>
      </div>

      {/* Sidebar Content */}
      <div className="flex-grow overflow-auto p-3 space-y-3 scrollbar-thin scrollbar-thumb-ramp-grey-700">
        {loading && runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2">
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
            <span className="text-xs text-gray-400">Loading history...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-10 gap-2 text-center text-red-400">
            <AlertCircle className="h-5 w-5 text-red-500" />
            <span className="text-xs">{error}</span>
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
  );
}
