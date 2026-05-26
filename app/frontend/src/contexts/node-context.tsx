import { LanguageModel } from '@/data/models';
import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

export type NodeStatus = 'IDLE' | 'IN_PROGRESS' | 'COMPLETE' | 'ERROR';

// Message history item
export interface MessageItem {
  timestamp: string;
  message: string;
  ticker: string | null;
  analysis: Record<string, string>;
}

// Agent node state structure
export interface AgentNodeData {
  status: NodeStatus;
  ticker: string | null;
  message: string;
  lastUpdated: number;
  messages: MessageItem[];
  timestamp?: string;
  analysis: string | null;
  backtestResults?: any[];
}

// Data structure for the output node data (from complete event)
export interface OutputNodeData {
  decisions: Record<string, any>;
  analyst_signals: Record<string, any>;
  // Backtest-specific fields
  performance_metrics?: {
    sharpe_ratio?: number;
    sortino_ratio?: number;
    max_drawdown?: number;
    max_drawdown_date?: string;
    long_short_ratio?: number;
    gross_exposure?: number;
    net_exposure?: number;
  };
  final_portfolio?: {
    cash: number;
    margin_used: number;
    positions: Record<string, any>;
  };
  total_days?: number;
}

// Default agent node state
const DEFAULT_AGENT_NODE_STATE: AgentNodeData = {
  status: 'IDLE',
  ticker: null,
  message: '',
  messages: [],
  lastUpdated: Date.now(),
  analysis: null,
};

// Helper function to create flow-aware composite keys
function createCompositeKey(flowId: string | null, nodeId: string): string {
  return flowId ? `${flowId}:${nodeId}` : nodeId;
}

interface NodeContextType {
  agentNodeData: Record<string, AgentNodeData>;
  outputNodeData: OutputNodeData | null;
  agentModels: Record<string, LanguageModel | null>;
  error: string | null;
  setError: (err: string | null) => void;
  updateAgentNode: (flowId: string | null, nodeId: string, data: Partial<AgentNodeData> | NodeStatus) => void;
  updateAgentNodes: (flowId: string | null, nodeIds: string[], status: NodeStatus) => void;
  setOutputNodeData: (flowId: string | null, data: OutputNodeData) => void;
  setAgentModel: (flowId: string | null, nodeId: string, model: LanguageModel | null) => void;
  getAgentModel: (flowId: string | null, nodeId: string) => LanguageModel | null;
  getAllAgentModels: (flowId: string | null) => Record<string, LanguageModel | null>;
  resetAllNodes: (flowId: string | null) => void;
  resetNodeStatuses: (flowId: string | null) => void;
  exportNodeContextData: (flowId: string | null) => {
    agentNodeData: Record<string, AgentNodeData>;
    outputNodeData: OutputNodeData | null;
  };
  importNodeContextData: (flowId: string | null, data: {
    agentNodeData?: Record<string, AgentNodeData>;
    outputNodeData?: OutputNodeData | null;
  }) => void;
  // New flow-aware functions
  getAgentNodeDataForFlow: (flowId: string | null) => Record<string, AgentNodeData>;
  getOutputNodeDataForFlow: (flowId: string | null) => OutputNodeData | null;
  loadPastRun: (flowId: string | null, logs: any[], decisions: any, analystSignals: any) => void;
}

const NodeContext = createContext<NodeContextType | undefined>(undefined);

export function NodeProvider({ children }: { children: ReactNode }) {
  // Use composite keys for flow-aware agent node data storage
  const [agentNodeData, setAgentNodeData] = useState<Record<string, AgentNodeData>>({});
  // Flow-aware output node data storage
  const [outputNodeData, setOutputNodeData] = useState<Record<string, OutputNodeData>>({});
  // Agent models also need to be flow-aware to maintain model selections per flow
  const [agentModels, setAgentModels] = useState<Record<string, LanguageModel | null>>({});
  // LLM/backend errors
  const [error, setError] = useState<string | null>(null);

  const updateAgentNode = useCallback((flowId: string | null, nodeId: string, data: Partial<AgentNodeData> | NodeStatus) => {
    const compositeKey = createCompositeKey(flowId, nodeId);
    
    // Handle string status shorthand (just passing a status string)
    if (typeof data === 'string') {
      setAgentNodeData(prev => {
        const existingNode = prev[compositeKey] || { ...DEFAULT_AGENT_NODE_STATE };
        return {
          ...prev,
          [compositeKey]: {
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
      const existingNode = prev[compositeKey] || { ...DEFAULT_AGENT_NODE_STATE };
      
      const newMessages = [...existingNode.messages];
      
      // Add message to history if it's new
      if (data.message && data.timestamp) {
        const messageExists = newMessages.some(msg => 
          msg.timestamp === data.timestamp && 
          msg.message === data.message &&
          msg.ticker === data.ticker
        );
        
        if (!messageExists) {
          const ticker = data.ticker || null;

          const messageItem: MessageItem = {
            timestamp: data.timestamp,
            message: data.message,
            ticker: ticker,
            analysis: {} as Record<string, string>,
          }

          if (ticker && data.analysis) {
            messageItem.analysis[ticker] = data.analysis;
          }

          newMessages.push(messageItem);
        }
      }
      
      const updatedNode = {
        ...existingNode,
        ...data,
        messages: newMessages,
        lastUpdated: Date.now()
      };
      
      return {
        ...prev,
        [compositeKey]: updatedNode
      };
    });
  }, []);

  const updateAgentNodes = useCallback((flowId: string | null, nodeIds: string[], status: NodeStatus) => {
    if (nodeIds.length === 0) return;
    
    setAgentNodeData(prev => {
      const newStates = { ...prev };
      
      nodeIds.forEach(id => {
        const compositeKey = createCompositeKey(flowId, id);
        newStates[compositeKey] = {
          ...(newStates[compositeKey] || { ...DEFAULT_AGENT_NODE_STATE }),
          status,
          lastUpdated: Date.now()
        };
      });
      
      return newStates;
    });
  }, []);

  const setAgentModel = useCallback((flowId: string | null, nodeId: string, model: LanguageModel | null) => {
    const compositeKey = createCompositeKey(flowId, nodeId);
    
    setAgentModels(prev => {
      if (model === null) {
        const { [compositeKey]: removed, ...rest } = prev;
        return rest;
      } else {
        return {
          ...prev,
          [compositeKey]: model
        };
      }
    });
  }, []);

  const getAgentModel = useCallback((flowId: string | null, nodeId: string): LanguageModel | null => {
    const compositeKey = createCompositeKey(flowId, nodeId);
    return agentModels[compositeKey] || null;
  }, [agentModels]);

  const getAllAgentModels = useCallback((flowId: string | null): Record<string, LanguageModel | null> => {
    if (!flowId) {
      return Object.fromEntries(
        Object.entries(agentModels).filter(([key]) => !key.includes(':'))
      );
    }
    
    const flowPrefix = `${flowId}:`;
    const currentFlowModels: Record<string, LanguageModel | null> = {};
    
    Object.entries(agentModels).forEach(([compositeKey, model]) => {
      if (compositeKey.startsWith(flowPrefix)) {
        const nodeId = compositeKey.substring(flowPrefix.length);
        currentFlowModels[nodeId] = model;
      }
    });
    
    return currentFlowModels;
  }, [agentModels]);

  const setOutputNodeDataForFlow = useCallback((flowId: string | null, data: OutputNodeData) => {
    if (!flowId) {
      setOutputNodeData(prev => ({ ...prev, 'default': data }));
    } else {
      setOutputNodeData(prev => ({ ...prev, [flowId]: data }));
    }
  }, []);

  const resetAllNodes = useCallback((flowId: string | null) => {
    if (!flowId) {
      setAgentNodeData({});
      setOutputNodeData({});
      setError(null);
    } else {
      const flowPrefix = `${flowId}:`;
      setAgentNodeData(prev => {
        const newData: Record<string, AgentNodeData> = {};
        Object.entries(prev).forEach(([key, value]) => {
          if (!key.startsWith(flowPrefix)) {
            newData[key] = value;
          }
        });
        return newData;
      });
      
      setOutputNodeData(prev => {
        const { [flowId]: removed, ...rest } = prev;
        return rest;
      });
    }
  }, []);

  const resetNodeStatuses = useCallback((flowId: string | null) => {
    if (!flowId) {
      setAgentNodeData(prev => {
        const newData: Record<string, AgentNodeData> = {};
        Object.entries(prev).forEach(([key, value]) => {
          newData[key] = {
            ...value,
            status: 'IDLE',
            lastUpdated: Date.now(),
          };
        });
        return newData;
      });
    } else {
      const flowPrefix = `${flowId}:`;
      setAgentNodeData(prev => {
        const newData: Record<string, AgentNodeData> = {};
        Object.entries(prev).forEach(([key, value]) => {
          if (key.startsWith(flowPrefix)) {
            newData[key] = {
              ...value,
              status: 'IDLE',
              lastUpdated: Date.now(),
            };
          } else {
            newData[key] = value;
          }
        });
        return newData;
      });
    }
  }, []);

  const exportNodeContextData = useCallback((flowId: string | null) => {
    const currentFlowAgentData: Record<string, AgentNodeData> = {};
    const flowPrefix = flowId ? `${flowId}:` : '';
    
    Object.entries(agentNodeData).forEach(([compositeKey, data]) => {
      if (flowId) {
        if (compositeKey.startsWith(flowPrefix)) {
          const nodeId = compositeKey.substring(flowPrefix.length);
          currentFlowAgentData[nodeId] = data;
        }
      } else {
        if (!compositeKey.includes(':')) {
          currentFlowAgentData[compositeKey] = data;
        }
      }
    });

    const currentFlowOutputData = flowId 
      ? outputNodeData[flowId] || null
      : outputNodeData['default'] || null;

    return {
      agentNodeData: currentFlowAgentData,
      outputNodeData: currentFlowOutputData,
    };
  }, [agentNodeData, outputNodeData]);

  const importNodeContextData = useCallback((flowId: string | null, data: {
    agentNodeData?: Record<string, AgentNodeData>;
    outputNodeData?: OutputNodeData | null;
  }) => {
    if (data.agentNodeData) {
      Object.entries(data.agentNodeData).forEach(([nodeId, nodeData]) => {
        const compositeKey = createCompositeKey(flowId, nodeId);
        setAgentNodeData(prev => ({
          ...prev,
          [compositeKey]: nodeData,
        }));
      });
    }

    if (data.outputNodeData) {
      if (flowId) {
        setOutputNodeData(prev => ({
          ...prev,
          [flowId]: data.outputNodeData!,
        }));
      } else {
        setOutputNodeData(prev => ({
          ...prev,
          'default': data.outputNodeData!,
        }));
      }
    }
  }, []);

  const getAgentNodeDataForFlow = useCallback((flowId: string | null): Record<string, AgentNodeData> => {
    if (!flowId) {
      return Object.fromEntries(
        Object.entries(agentNodeData).filter(([key]) => !key.includes(':'))
      );
    }
    
    const flowPrefix = `${flowId}:`;
    const currentFlowData: Record<string, AgentNodeData> = {};
    
    Object.entries(agentNodeData).forEach(([compositeKey, data]) => {
      if (compositeKey.startsWith(flowPrefix)) {
        const nodeId = compositeKey.substring(flowPrefix.length);
        currentFlowData[nodeId] = data;
      }
    });
    
    return currentFlowData;
  }, [agentNodeData]);

  const getOutputNodeDataForFlow = useCallback((flowId: string | null): OutputNodeData | null => {
    if (!flowId) {
      return outputNodeData['default'] || null;
    }
    return outputNodeData[flowId] || null;
  }, [outputNodeData]);

  const loadPastRun = useCallback((flowId: string | null, logs: any[], decisions: any, analystSignals: any) => {
    resetAllNodes(flowId);
    
    if (decisions && analystSignals) {
      setOutputNodeDataForFlow(flowId, {
        decisions,
        analyst_signals: analystSignals
      });
    }

    const newAgentData: Record<string, AgentNodeData> = {};
    
    logs.forEach(event => {
      if (event.type === 'progress' && event.agent) {
        const nodeId = event.agent.replace('_agent', '');
        const compositeKey = createCompositeKey(flowId, nodeId);
        
        let nodeStatus: NodeStatus = 'IN_PROGRESS';
        if (event.status === 'Done') {
          nodeStatus = 'COMPLETE';
        }
        
        const existingNode = newAgentData[compositeKey] || {
          status: 'IDLE',
          ticker: null,
          message: '',
          messages: [],
          lastUpdated: Date.now(),
          analysis: null,
        };
        
        const newMessages = [...existingNode.messages];
        const msgText = `${event.status} for ${event.ticker || 'all stocks'}`;
        
        const ticker = event.ticker || null;
        const messageItem: MessageItem = {
          timestamp: event.timestamp || new Date().toISOString(),
          message: msgText,
          ticker: ticker,
          analysis: {} as Record<string, string>,
        };

        if (ticker && event.analysis) {
          messageItem.analysis[ticker] = event.analysis;
        }
        
        newMessages.push(messageItem);
        
        newAgentData[compositeKey] = {
          status: nodeStatus,
          ticker: ticker,
          message: msgText,
          messages: newMessages,
          lastUpdated: Date.now(),
          analysis: event.analysis || null,
        };
      }
    });

    if (decisions) {
      Object.keys(newAgentData).forEach(compositeKey => {
        newAgentData[compositeKey].status = 'COMPLETE';
      });
      const outputKey = createCompositeKey(flowId, 'output');
      newAgentData[outputKey] = {
        status: 'COMPLETE',
        ticker: null,
        message: 'Analysis complete',
        messages: [],
        lastUpdated: Date.now(),
        analysis: null,
      };
    }

    setAgentNodeData(prev => ({
      ...prev,
      ...newAgentData
    }));
  }, [resetAllNodes, setOutputNodeDataForFlow]);

  const contextValue = {
    agentNodeData: {},
    outputNodeData: null,
    agentModels,
    error,
    setError,
    updateAgentNode,
    updateAgentNodes,
    setOutputNodeData: setOutputNodeDataForFlow,
    setAgentModel,
    getAgentModel,
    getAllAgentModels,
    resetAllNodes,
    resetNodeStatuses,
    exportNodeContextData,
    importNodeContextData,
    getAgentNodeDataForFlow,
    getOutputNodeDataForFlow,
    loadPastRun,
  };

  return (
    <NodeContext.Provider value={contextValue}>
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