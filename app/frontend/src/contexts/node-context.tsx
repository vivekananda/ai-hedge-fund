import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

export type NodeStatus = 'IDLE' | 'IN_PROGRESS' | 'COMPLETE' | 'ERROR';

// Message history item
export interface MessageItem {
  timestamp: string;
  message: string;
  ticker: string | null;
}

// Agent node state structure
export interface AgentNodeData {
  status: NodeStatus;
  ticker: string | null;
  message: string;
  lastUpdated: number;
  messages: MessageItem[];
  timestamp?: string;
}

// Data structure for the output node data (from complete event)
export interface OutputNodeData {
  decisions: Record<string, any>;
  analyst_signals: Record<string, any>;
}

// Default agent node state
const DEFAULT_AGENT_NODE_STATE: AgentNodeData = {
  status: 'IDLE',
  ticker: null,
  message: '',
  messages: [],
  lastUpdated: Date.now()
};

interface NodeContextType {
  agentNodeData: Record<string, AgentNodeData>;
  outputNodeData: OutputNodeData | null;
  updateAgentNode: (nodeId: string, data: Partial<AgentNodeData> | NodeStatus) => void;
  updateAgentNodes: (nodeIds: string[], status: NodeStatus) => void;
  setOutputNodeData: (data: OutputNodeData) => void;
  resetAllNodes: () => void;
  loadPastRun: (logs: any[], decisions: any, analystSignals: any) => void;
}

const NodeContext = createContext<NodeContextType | undefined>(undefined);

export function NodeProvider({ children }: { children: ReactNode }) {
  const [agentNodeData, setAgentNodeData] = useState<Record<string, AgentNodeData>>({});
  const [outputNodeData, setOutputNodeData] = useState<OutputNodeData | null>(null);

  const updateAgentNode = useCallback((nodeId: string, data: Partial<AgentNodeData> | NodeStatus) => {
    // Handle string status shorthand (just passing a status string)
    if (typeof data === 'string') {
      setAgentNodeData(prev => {
        const existingNode = prev[nodeId] || { ...DEFAULT_AGENT_NODE_STATE };
        return {
          ...prev,
          [nodeId]: {
            ...existingNode,
            status: data,
            lastUpdated: Date.now()
          }
        };
      });
      return;
    }

    // Handle data object - full update
    setAgentNodeData(prev => {
      const existingNode = prev[nodeId] || { ...DEFAULT_AGENT_NODE_STATE };
      const newMessages = [...existingNode.messages];
      
      // Add message to history if it's new
      if (data.message && data.message !== existingNode.message) {
        newMessages.push({
          timestamp: data.timestamp || new Date().toISOString(),
          message: data.message,
          ticker: data.ticker || existingNode.ticker
        });
      }
      
      return {
        ...prev,
        [nodeId]: {
          ...existingNode,
          ...data,
          messages: newMessages,
          lastUpdated: Date.now()
        }
      };
    });
  }, []);

  const updateAgentNodes = useCallback((nodeIds: string[], status: NodeStatus) => {
    if (nodeIds.length === 0) return;
    
    setAgentNodeData(prev => {
      const newStates = { ...prev };
      
      nodeIds.forEach(id => {
        newStates[id] = {
          ...(newStates[id] || { ...DEFAULT_AGENT_NODE_STATE }),
          status,
          lastUpdated: Date.now()
        };
      });
      
      return newStates;
    });
  }, []);

  const resetAllNodes = useCallback(() => {
    setAgentNodeData({});
    setOutputNodeData(null);
  }, []);

  const loadPastRun = useCallback((logs: any[], decisions: any, analystSignals: any) => {
    // Reset first
    setAgentNodeData({});
    setOutputNodeData(null);
    
    // Set output data if present
    if (decisions && analystSignals) {
      setOutputNodeData({
        decisions,
        analyst_signals: analystSignals
      });
    }

    // Reconstruct agentNodeData from logs
    const newAgentData: Record<string, AgentNodeData> = {};
    
    logs.forEach(event => {
      if (event.type === 'progress' && event.agent) {
        const nodeId = event.agent.replace('_agent', '');
        
        let nodeStatus: NodeStatus = 'IN_PROGRESS';
        if (event.status === 'Done') {
          nodeStatus = 'COMPLETE';
        }
        
        const existingNode = newAgentData[nodeId] || {
          status: 'IDLE',
          ticker: null,
          message: '',
          messages: [],
          lastUpdated: Date.now()
        };
        
        const newMessages = [...existingNode.messages];
        const msgText = `${event.status} for ${event.ticker || 'all stocks'}`;
        
        newMessages.push({
          timestamp: event.timestamp || new Date().toISOString(),
          message: msgText,
          ticker: event.ticker
        });
        
        newAgentData[nodeId] = {
          status: nodeStatus,
          ticker: event.ticker || null,
          message: msgText,
          messages: newMessages,
          lastUpdated: Date.now()
        };
      }
    });

    // Mark active nodes and output node as complete if decisions are loaded
    if (decisions) {
      Object.keys(newAgentData).forEach(id => {
        newAgentData[id].status = 'COMPLETE';
      });
      newAgentData['output'] = {
        status: 'COMPLETE',
        ticker: null,
        message: 'Analysis complete',
        messages: [],
        lastUpdated: Date.now()
      };
    }

    setAgentNodeData(newAgentData);
  }, []);

  return (
    <NodeContext.Provider
      value={{
        agentNodeData,
        outputNodeData,
        updateAgentNode,
        updateAgentNodes,
        setOutputNodeData,
        resetAllNodes,
        loadPastRun,
      }}
    >
      {children}
    </NodeContext.Provider>
  );
}

export function useNodeContext() {
  const context = useContext(NodeContext);
  
  if (context === undefined) {
    throw new Error('useNodeContext must be used within a NodeProvider');
  }
  
  return context;
} 