import { NodeStatus, OutputNodeData, useNodeContext } from '@/contexts/node-context';
import { ModelProvider } from '@/services/types';

export interface HedgeFundRequest {
  tickers: string[];
  selected_agents: string[];
  end_date?: string;
  start_date?: string;
  model_name?: string;
  model_provider?: ModelProvider;
  initial_cash?: number;
  margin_requirement?: number;
}

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
   * Runs a hedge fund simulation with the given parameters and streams the results
   * @param params The hedge fund request parameters
   * @param nodeContext Node context for updating node states
   * @returns A function to abort the SSE connection
   */
  runHedgeFund: (
    params: HedgeFundRequest, 
    nodeContext: ReturnType<typeof useNodeContext>
  ): (() => void) => {
    // Convert tickers string to array if needed
    if (typeof params.tickers === 'string') {
      params.tickers = (params.tickers as unknown as string).split(',').map(t => t.trim());
    }

    // For SSE connections with FastAPI, we need to use POST
    // First, create the controller
    const controller = new AbortController();
    const { signal } = controller;

    // Make a POST request with the JSON body
    fetch(`${API_BASE_URL}/hedge-fund/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
      signal,
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
            
      // Process the response as a stream of SSE events
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('Failed to get response reader');
      }
      
      const decoder = new TextDecoder();
      let buffer = '';
      
      // Function to process the stream
      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              break;
            }
            
            // Decode the chunk and add to buffer
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            
            // Process any complete events in the buffer (separated by double newlines)
            const events = buffer.split('\n\n');
            buffer = events.pop() || ''; // Keep last partial event in buffer
            
            for (const eventText of events) {
              if (!eventText.trim()) continue;
                            
              try {
                // Parse the event type and data from the SSE format
                const eventTypeMatch = eventText.match(/^event: (.+)$/m);
                const dataMatch = eventText.match(/^data: (.+)$/m);
                
                if (eventTypeMatch && dataMatch) {
                  const eventType = eventTypeMatch[1];
                  const eventData = JSON.parse(dataMatch[1]);
                  
                  console.log(`Parsed ${eventType} event:`, eventData);
                  
                  // Process based on event type
                  switch (eventType) {
                    case 'start':
                      // Reset all nodes at the start of a new run
                      nodeContext.resetAllNodes();
                      break;
                    case 'progress':
                      if (eventData.agent) {
                        // Map the progress to a node status
                        let nodeStatus: NodeStatus = 'IN_PROGRESS';
                        if (eventData.status === 'Done') {
                          nodeStatus = 'COMPLETE';
                        }
                        // Use the agent name as the node ID
                        const agentId = eventData.agent.replace('_agent', '');
                        
                        // Use the enhanced API to update both status and additional data
                        nodeContext.updateAgentNode(agentId, {
                          status: nodeStatus,
                          ticker: eventData.ticker,
                          message: eventData.status
                        });
                      }
                      break;
                    case 'complete':
                      // Store the complete event data in the node context
                      if (eventData.data) {
                        nodeContext.setOutputNodeData(eventData.data as OutputNodeData);
                      }
                      // Mark all agents as complete when the whole process is done
                      nodeContext.updateAgentNodes(params.selected_agents || [], 'COMPLETE');
                      // Also update the output node
                      nodeContext.updateAgentNode('output', {
                        status: 'COMPLETE',
                        message: 'Analysis complete'
                      });
                      break;
                    case 'error':
                      // Mark all agents as error when there's an error
                      nodeContext.updateAgentNodes(params.selected_agents || [], 'ERROR');
                      nodeContext.setError(eventData.message || 'Simulation analysis failed.');
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
        } catch (error: any) { // Type assertion for error
          if (error.name !== 'AbortError') {
            console.error('Error reading SSE stream:', error);
            // Mark all agents as error when there's a connection error
            const agentIds = params.selected_agents || [];
            nodeContext.updateAgentNodes(agentIds, 'ERROR');
            nodeContext.setError(error.message || 'Error processing analysis stream.');
          }
        }
      };
      
      // Start processing the stream
      processStream();
    })
    .catch((error: any) => { // Type assertion for error
      if (error.name !== 'AbortError') {
        console.error('SSE connection error:', error);
        // Mark all agents as error when there's a connection error
        const agentIds = params.selected_agents || [];
        nodeContext.updateAgentNodes(agentIds, 'ERROR');
        nodeContext.setError(error.message || 'Failed to connect to simulation server.');
      }
    });

    // Return abort function
    return () => {
      controller.abort();
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