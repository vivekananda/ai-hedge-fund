import { ModelSelector } from '@/components/ui/llm-selector';
import { getConnectedEdges, useReactFlow, type NodeProps } from '@xyflow/react';
import { Bot, Loader2, Play, AlertCircle } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components/ui/button';
import { CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useNodeContext } from '@/contexts/node-context';
import { useWatchlist } from '@/contexts/watchlist-context';
import { apiModels } from '@/data/models';
import { api } from '@/services/api';
import { type TextInputNode } from '../types';
import { NodeShell } from './node-shell';

export function TextInputNode({
  data,
  selected,
  id,
  isConnectable,
}: NodeProps<TextInputNode>) {
  const {
    simulationTickers,
    setSimulationTickers,
    selectedModel,
    setSelectedModel,
    pendingAutoRun,
    setPendingAutoRun,
    watchlists
  } = useWatchlist();
  
  const nodeContext = useNodeContext();
  const { resetAllNodes, agentNodeData, error } = nodeContext;
  const { getNodes, getEdges } = useReactFlow();
  const abortControllerRef = useRef<(() => void) | null>(null);
  
  // Check if any agent is in progress
  const isProcessing = Object.values(agentNodeData).some(
    agent => agent.status === 'IN_PROGRESS'
  );
  
  // Clean up SSE connection on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current();
      }
    };
  }, []);

  const handlePlay = () => {
    // First, reset all nodes to IDLE
    resetAllNodes();
    
    // Clean up any existing connection
    if (abortControllerRef.current) {
      abortControllerRef.current();
    }
    
    // Call the backend API with SSE
    const tickerList = simulationTickers.split(',').map(t => t.trim()).filter(Boolean);
    if (tickerList.length === 0) return;
    
    // Get the nodes and edges
    const nodes = getNodes();
    const edges = getEdges();
    const connectedEdges = getConnectedEdges(nodes, edges);
    
    // Get all nodes that are agents and are connected in the flow
    const selectedAgents = new Set<string>();
    
    // Collect all the target node IDs from connected edges
    const connectedNodeIds = new Set<string>();
    connectedEdges.forEach(edge => {
      if (edge.source === id) {
        connectedNodeIds.add(edge.target);
      }
    });
    
    // Filter for nodes that are agents
    nodes.forEach(node => {
      if (node.type === 'agent-node' && connectedNodeIds.has(node.id)) {
        selectedAgents.add(node.id);
      }
    });
        
    abortControllerRef.current = api.runHedgeFund(
      {
        tickers: tickerList,
        selected_agents: Array.from(selectedAgents),
        model_name: selectedModel?.model_name || undefined,
        model_provider: selectedModel?.provider as any || undefined,
      },
      // Pass the node status context to the API
      nodeContext
    );
  };

  // Watch for auto-run trigger from screener
  useEffect(() => {
    if (pendingAutoRun && simulationTickers.trim()) {
      // Small timeout to ensure react flow and nodes are fully initialized in DOM
      const timer = setTimeout(() => {
        handlePlay();
        setPendingAutoRun(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [pendingAutoRun, simulationTickers]);

  return (
    <NodeShell
      id={id}
      selected={selected}
      isConnectable={isConnectable}
      icon={<Bot className="h-5 w-5" />}
      name={data.name || "Custom Component"}
      description={data.description}
      hasLeftHandle={false}
    >
      <CardContent className="p-0">
        <div className="border-t border-border p-3">
          <div className="flex flex-col gap-4">
            {/* Tickers Input */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="text-subtitle text-muted-foreground flex items-center gap-1">
                  Tickers
                </div>
                {watchlists.length > 0 && (
                  <select
                    onChange={(e) => {
                      const selectedListName = e.target.value;
                      if (selectedListName) {
                        const selectedList = watchlists.find(w => w.name === selectedListName);
                        if (selectedList && selectedList.tickers.length > 0) {
                          setSimulationTickers(selectedList.tickers.join(', '));
                        }
                      }
                      e.target.value = ''; // Reset select after loading
                    }}
                    className="bg-ramp-grey-950 border border-ramp-grey-800 text-gray-400 text-[10px] rounded px-1.5 py-0.5 max-w-[120px] focus:outline-none focus:border-cyan-500"
                  >
                    <option value="">Load List...</option>
                    {watchlists.map(w => (
                      <option key={w.id} value={w.name}>
                        {w.name} ({w.tickers.length})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="flex gap-2">
                <Input
                  placeholder="Enter tickers"
                  value={simulationTickers}
                  onChange={(e) => setSimulationTickers(e.target.value)}
                />
                <Button 
                  size="icon" 
                  variant="secondary"
                  className="flex-shrink-0 transition-all duration-200 hover:bg-primary hover:text-primary-foreground active:scale-95"
                  onClick={handlePlay}
                  disabled={isProcessing || !simulationTickers.trim()}
                >
                  {isProcessing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="text-subtitle text-muted-foreground flex items-center gap-1">
                Model
              </div>
              <ModelSelector
                models={apiModels}
                value={selectedModel?.model_name || ""}
                onChange={setSelectedModel}
                placeholder="Select a model..."
              />
            </div>
            {error && (
              <div className="flex items-start gap-2 p-2.5 bg-red-950/40 border border-red-900/30 rounded-lg text-red-400 text-[10px] leading-relaxed">
                <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 text-red-500 mt-0.5" />
                <span className="break-all">{error}</span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </NodeShell>
  );
}

