import { NodeStatus, OutputNodeData, useNodeContext } from '@/contexts/node-context';
import { Agent } from '@/data/agents';
import { LanguageModel } from '@/data/models';
import { extractBaseAgentKey } from '@/data/node-mappings';
import { flowConnectionManager } from '@/hooks/use-flow-connection';
import { HedgeFundRequest } from '@/services/types';

export interface Watchlist {
  id: number;
  name: string;
  tickers: string[];
  created_at: string;
}

export interface WeeklyPick {
  rank: number;
  symbol: string;
  name: string;
  signal: string;
  score: number;
  thesis: string;
  risk_score: number;
}

export interface WeeklyRun {
  id: number;
  run_date: string;
  status: string;
  error_message?: string;
  test_mode: boolean;
  created_at: string;
  watchlist_name?: string;
}

export interface SimulationRunMetadata {
  id: string;
  created_at: string;
  tickers: string[];
  selected_agents: string[];
  model_name: string;
  model_provider: string;
  status: string;
}

export interface SimulationRunDetail extends SimulationRunMetadata {
  initial_cash?: number;
  margin_requirement?: number;
  decisions: Record<string, any> | null;
  analyst_signals: Record<string, any> | null;
  logs: any[];
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8008';

export const api = {
  /**
   * Gets the list of available agents from the backend
   * @returns Promise that resolves to the list of agents
   */
  getAgents: async (): Promise<Agent[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/hedge-fund/agents`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data.agents;
    } catch (error) {
      console.error('Failed to fetch agents:', error);
      throw error;
    }
  },

  /**
   * Gets the list of available models from the backend
   * @returns Promise that resolves to the list of models
   */
  getLanguageModels: async (): Promise<LanguageModel[]> => {
    try {
      const response = await fetch(`${API_BASE_URL}/language-models/`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data.models;
    } catch (error) {
      console.error('Failed to fetch models:', error);
      throw error;
    }
  },

  /**
   * Saves JSON data to a file in the project's /outputs directory
   * @param filename The name of the file to save
   * @param data The JSON data to save
   * @returns Promise that resolves when the file is saved
   */
  saveJsonFile: async (filename: string, data: any): Promise<void> => {
    try {
      const response = await fetch(`${API_BASE_URL}/storage/save-json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename,
          data
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      console.log(result.message);
    } catch (error) {
      console.error('Failed to save JSON file:', error);
      throw error;
    }
  },

  /**
   * Runs a hedge fund simulation with the given parameters and streams the results
   * @param params The hedge fund request parameters
   * @param nodeContext Node context for updating node states
   * @param flowId The ID of the current flow
   * @returns A function to abort the SSE connection
   */
  runHedgeFund: (
    params: HedgeFundRequest, 
    nodeContext: ReturnType<typeof useNodeContext>,
    flowId: string | null = null
  ): (() => void) => {
    if (typeof params.tickers === 'string') {
      params.tickers = (params.tickers as unknown as string).split(',').map(t => t.trim());
    }

    const getAgentIds = () => params.graph_nodes.map(node => node.id);
    const backendParams = params;

    const controller = new AbortController();
    const { signal } = controller;

    fetch(`${API_BASE_URL}/hedge-fund/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(backendParams),
      signal,
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
            
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      
      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              break;
            }
            
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';
            
            for (const eventText of events) {
              if (!eventText.trim()) continue;
                            
              try {
                const eventTypeMatch = eventText.match(/^event: (.+)$/m);
                const dataMatch = eventText.match(/^data: (.+)$/m);
                
                if (eventTypeMatch && dataMatch) {
                  const eventType = eventTypeMatch[1];
                  const eventData = JSON.parse(dataMatch[1]);
                  
                  console.log(`Parsed ${eventType} event:`, eventData);
                  
                  switch (eventType) {
                    case 'start':
                      nodeContext.resetAllNodes(flowId);
                      break;
                    case 'progress':
                      if (eventData.agent) {
                        let nodeStatus: NodeStatus = 'IN_PROGRESS';
                        if (eventData.status === 'Done') {
                          nodeStatus = 'COMPLETE';
                        }
                        const baseAgentKey = eventData.agent.replace('_agent', '');
                        const uniqueNodeId = getAgentIds().find(id => 
                          extractBaseAgentKey(id) === baseAgentKey
                        ) || baseAgentKey;
                                                
                        nodeContext.updateAgentNode(flowId, uniqueNodeId, {
                          status: nodeStatus,
                          ticker: eventData.ticker,
                          message: eventData.status,
                          analysis: eventData.analysis,
                          timestamp: eventData.timestamp
                        });
                      }
                      break;
                    case 'complete':
                      if (eventData.data) {
                        nodeContext.setOutputNodeData(flowId, eventData.data as OutputNodeData);
                      }
                      nodeContext.updateAgentNodes(flowId, getAgentIds(), 'COMPLETE');
                      nodeContext.updateAgentNode(flowId, 'output', {
                        status: 'COMPLETE',
                        message: 'Analysis complete'
                      });

                      if (flowId) {
                        flowConnectionManager.setConnection(flowId, {
                          state: 'completed',
                          abortController: null,
                        });

                        setTimeout(() => {
                          const currentConnection = flowConnectionManager.getConnection(flowId);
                          if (currentConnection.state === 'completed') {
                            flowConnectionManager.setConnection(flowId, {
                              state: 'idle',
                            });
                          }
                        }, 30000);
                      }
                      break;
                    case 'error':
                      nodeContext.updateAgentNodes(flowId, getAgentIds(), 'ERROR');
                      nodeContext.setError(eventData.message || 'Simulation analysis failed.');
                      
                      if (flowId) {
                        flowConnectionManager.setConnection(flowId, {
                          state: 'error',
                          error: eventData.message || 'Unknown error occurred',
                          abortController: null,
                        });
                      }
                      break;
                    default:
                      console.warn('Unknown event type:', eventType);
                  }
                }
              } catch (err) {
                console.error('Error parsing SSE event:', err, 'Raw event:', eventText);
              }
            }
          }
          
          if (flowId) {
            const currentConnection = flowConnectionManager.getConnection(flowId);
            if (currentConnection.state === 'connected') {
              flowConnectionManager.setConnection(flowId, {
                state: 'completed',
                abortController: null,
              });
            }
          }
        } catch (error: any) {
          if (error.name !== 'AbortError') {
            console.error('Error reading SSE stream:', error);
            nodeContext.updateAgentNodes(flowId, getAgentIds(), 'ERROR');
            nodeContext.setError(error.message || 'Error processing analysis stream.');
            
            if (flowId) {
              flowConnectionManager.setConnection(flowId, {
                state: 'error',
                error: error.message || 'Connection error',
                abortController: null,
              });
            }
          }
        }
      };
      
      processStream();
    })
    .catch((error: any) => {
      if (error.name !== 'AbortError') {
        console.error('SSE connection error:', error);
        nodeContext.updateAgentNodes(flowId, getAgentIds(), 'ERROR');
        nodeContext.setError(error.message || 'Failed to connect to simulation server.');
        
        if (flowId) {
          flowConnectionManager.setConnection(flowId, {
            state: 'error',
            error: error.message || 'Connection failed',
            abortController: null,
          });
        }
      }
    });

    return () => {
      controller.abort();
      if (flowId) {
        flowConnectionManager.setConnection(flowId, {
          state: 'idle',
          abortController: null,
        });
      }
    };
  },

  // Weekly picks endpoints
  getWeeklyPicksDates: async (watchlistName?: string): Promise<string[]> => {
    const url = watchlistName 
      ? `${API_BASE_URL}/weekly-picks/dates?watchlist_name=${encodeURIComponent(watchlistName)}`
      : `${API_BASE_URL}/weekly-picks/dates`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Failed to fetch weekly picks dates');
    return res.json();
  },

  getWeeklyPicks: async (date: string, watchlistName?: string): Promise<WeeklyPick[]> => {
    const url = watchlistName
      ? `${API_BASE_URL}/weekly-picks/picks/${date}?watchlist_name=${encodeURIComponent(watchlistName)}`
      : `${API_BASE_URL}/weekly-picks/picks/${date}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch weekly picks for ${date}`);
    return res.json();
  },

  getWeeklyRuns: async (): Promise<WeeklyRun[]> => {
    const res = await fetch(`${API_BASE_URL}/weekly-picks/runs`);
    if (!res.ok) throw new Error('Failed to fetch weekly pipeline runs');
    return res.json();
  },

  runWeeklyPipeline: async (modelName: string, modelProvider: string, testMode: boolean, watchlistName: string): Promise<WeeklyRun> => {
    const res = await fetch(`${API_BASE_URL}/weekly-picks/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model_name: modelName,
        model_provider: modelProvider,
        test_mode: testMode,
        watchlist_name: watchlistName,
      }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to start weekly picks pipeline');
    }
    return res.json();
  },

  // Simulation runs endpoints
  getSimulationRuns: async (): Promise<SimulationRunMetadata[]> => {
    const res = await fetch(`${API_BASE_URL}/hedge-fund/runs`);
    if (!res.ok) throw new Error('Failed to fetch simulation runs history');
    return res.json();
  },

  getSimulationRun: async (runId: string): Promise<SimulationRunDetail> => {
    const res = await fetch(`${API_BASE_URL}/hedge-fund/runs/${runId}`);
    if (!res.ok) throw new Error(`Failed to fetch simulation run details for ${runId}`);
    return res.json();
  },

  deleteSimulationRun: async (runId: string): Promise<{ message: string }> => {
    const res = await fetch(`${API_BASE_URL}/hedge-fund/runs/${runId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`Failed to delete simulation run ${runId}`);
    return res.json();
  },

  // Stocks endpoints
  syncStocksData: async (): Promise<{ message: string }> => {
    const res = await fetch(`${API_BASE_URL}/stocks/sync`, {
      method: 'POST',
    });
    if (!res.ok) throw new Error('Failed to sync stock data');
    return res.json();
  },

  // Watchlist endpoints
  getWatchlists: async (): Promise<Watchlist[]> => {
    const res = await fetch(`${API_BASE_URL}/watchlists`);
    if (!res.ok) throw new Error('Failed to fetch watchlists');
    return res.json();
  },

  saveWatchlist: async (name: string, tickers: string[]): Promise<Watchlist> => {
    const res = await fetch(`${API_BASE_URL}/watchlists`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, tickers }),
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || 'Failed to save watchlist');
    }
    return res.json();
  },

  deleteWatchlist: async (name: string): Promise<{ message: string }> => {
    const res = await fetch(`${API_BASE_URL}/watchlists/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Failed to delete watchlist ${name}`);
    }
    return res.json();
  },
};