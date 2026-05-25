import React, { useState, useEffect } from 'react';
import { Calendar, Play, Loader2, Shield, TrendingUp, TrendingDown, ArrowUpRight, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { ModelSelector } from './ui/llm-selector';
import { apiModels, defaultModel, ModelItem } from '@/data/models';
import { api, WeeklyPick, WeeklyRun } from '@/services/api';

export function WeeklyPicksDashboard() {
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [picks, setPicks] = useState<WeeklyPick[]>([]);
  const [loadingPicks, setLoadingPicks] = useState(false);
  const [activeRuns, setActiveRuns] = useState<WeeklyRun[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  
  // Controls
  const [selectedModel, setSelectedModel] = useState<ModelItem | null>(defaultModel);
  const [testMode, setTestMode] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll intervals
  useEffect(() => {
    fetchDates();
    fetchRuns();
    
    // Set up polling for active runs
    const interval = setInterval(() => {
      fetchRuns();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Fetch picks when selectedDate changes
  useEffect(() => {
    if (selectedDate) {
      fetchPicks(selectedDate);
    } else {
      setPicks([]);
    }
  }, [selectedDate]);

  // If a run just completed and we don't have a date selected, refresh dates
  const isRunning = activeRuns.some(r => r.status === 'RUNNING' || r.status === 'PENDING');
  
  const fetchDates = async () => {
    try {
      const availableDates = await api.getWeeklyPicksDates();
      setDates(availableDates);
      if (availableDates.length > 0 && !selectedDate) {
        setSelectedDate(availableDates[0]);
      }
    } catch (err) {
      console.error('Error fetching weekly pick dates:', err);
    }
  };

  const fetchPicks = async (date: string) => {
    try {
      setLoadingPicks(true);
      const data = await api.getWeeklyPicks(date);
      setPicks(data);
    } catch (err) {
      console.error('Error fetching picks:', err);
    } finally {
      setLoadingPicks(false);
    }
  };

  const fetchRuns = async () => {
    try {
      setLoadingRuns(true);
      const runs = await api.getWeeklyRuns();
      setActiveRuns(runs);
      
      // If there was a running job that completed, refresh dates
      const completedRun = runs.length > 0 && runs[0].status === 'COMPLETED';
      if (completedRun) {
        fetchDates();
      }
    } catch (err) {
      console.error('Error fetching runs:', err);
    } finally {
      setLoadingRuns(false);
    }
  };

  const handleRunPipeline = async () => {
    try {
      setIsTriggering(true);
      setError(null);
      await api.runWeeklyPipeline(
        selectedModel?.model_name || 'gemini-2.0-flash',
        selectedModel?.provider || 'Gemini',
        testMode
      );
      // Immediately fetch runs
      await fetchRuns();
    } catch (err: any) {
      setError(err.message || 'Failed to start weekly picks pipeline');
    } finally {
      setIsTriggering(false);
    }
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  // Status message helper
  const runningJob = activeRuns.find(r => r.status === 'RUNNING' || r.status === 'PENDING');
  const lastCompletedJob = activeRuns.find(r => r.status === 'COMPLETED' || r.status === 'FAILED');

  return (
    <div className="h-full overflow-y-auto bg-ramp-grey-1000 text-white p-6 space-y-6">
      {/* Upper Grid: Actions & Historical Runs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Run Pipeline Card */}
        <Card className="bg-ramp-grey-900 border-ramp-grey-800 text-white shadow-xl lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-white text-lg font-bold flex items-center gap-2">
              <Play className="h-5 w-5 text-cyan-400" />
              Trigger Weekly Analysis Pipeline
            </CardTitle>
            <CardDescription className="text-gray-400">
              Run the multi-agent hedge fund analyzer across Nifty 500 candidate stocks. Technical filters screen down to top 100 candidates, then qualitative AI agents decide the top 10 buys.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs text-gray-400 font-semibold tracking-wider uppercase">Select Model</span>
                <ModelSelector
                  models={apiModels}
                  value={selectedModel?.model_name || ""}
                  onChange={setSelectedModel}
                  placeholder="Select LLM model..."
                />
              </div>
              <div className="flex flex-col gap-2 justify-center">
                <span className="text-xs text-gray-400 font-semibold tracking-wider uppercase">Execution Mode</span>
                <div className="flex items-center gap-3 bg-ramp-grey-950 p-2.5 rounded-lg border border-ramp-grey-800 h-10">
                  <input
                    type="checkbox"
                    id="testMode"
                    checked={testMode}
                    onChange={(e) => setTestMode(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 bg-gray-900"
                  />
                  <label htmlFor="testMode" className="text-xs font-medium text-gray-300 cursor-pointer select-none">
                    Speed Test Mode (limit screening to top 20 stocks)
                  </label>
                </div>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-950/50 border border-red-900/50 rounded-lg text-red-400 text-xs">
                <AlertCircle className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {runningJob && (
              <div className="flex items-center gap-3 p-3 bg-indigo-950/30 border border-indigo-900/30 rounded-lg text-indigo-300 text-xs">
                <Loader2 className="h-4 w-4 animate-spin text-cyan-400 flex-shrink-0" />
                <div className="flex-1">
                  <span className="font-semibold">Pipeline Execution Status: </span>
                  <span className="capitalize font-mono">{runningJob.status}...</span>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Triggered at {new Date(runningJob.created_at).toLocaleTimeString()} ({runningJob.test_mode ? 'Speed Test' : 'Full Ingestion'}). This might take 1–2 minutes.
                  </p>
                </div>
              </div>
            )}

            {!runningJob && lastCompletedJob && lastCompletedJob.status === 'FAILED' && (
              <div className="flex items-center gap-3 p-3 bg-red-950/20 border border-red-900/30 rounded-lg text-red-400 text-xs">
                <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-500" />
                <div>
                  <span className="font-semibold">Last Execution Failed: </span>
                  <p className="text-[10px] text-gray-400 font-mono mt-0.5">{lastCompletedJob.error_message}</p>
                </div>
              </div>
            )}

            <Button
              className="w-full bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-semibold py-5 shadow-lg shadow-indigo-500/10 active:scale-[0.99] transition-all"
              disabled={isRunning || isTriggering}
              onClick={handleRunPipeline}
            >
              {isRunning || isTriggering ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Analyzing Stock Market Candidates...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 mr-2 fill-current" />
                  Run Weekly Stock Picks Analysis
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* History Select Card */}
        <Card className="bg-ramp-grey-900 border-ramp-grey-800 text-white shadow-xl">
          <CardHeader>
            <CardTitle className="text-white text-lg font-bold flex items-center gap-2">
              <Calendar className="h-5 w-5 text-indigo-400" />
              Analysis History
            </CardTitle>
            <CardDescription className="text-gray-400">
              Select a past weekly analysis to view the qualitative hedge fund picks.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2">
              <span className="text-xs text-gray-400 font-semibold tracking-wider uppercase">Select Date</span>
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full bg-ramp-grey-950 border border-ramp-grey-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {dates.length === 0 ? (
                  <option value="">No historical dates found</option>
                ) : (
                  dates.map(d => (
                    <option key={d} value={d}>
                      {formatDate(d)}
                    </option>
                  ))
                )}
              </select>
            </div>
            
            <div className="border-t border-ramp-grey-800 pt-4 space-y-2">
              <span className="text-xs text-gray-400 font-semibold tracking-wider uppercase block">Database Summary</span>
              <div className="flex justify-between text-xs text-gray-300 bg-ramp-grey-950 p-3 rounded-lg border border-ramp-grey-800">
                <span>Cached Weekly Runs:</span>
                <span className="font-bold text-white">{dates.length}</span>
              </div>
              <div className="flex justify-between text-xs text-gray-300 bg-ramp-grey-950 p-3 rounded-lg border border-ramp-grey-800">
                <span>Last Analysis Run:</span>
                <span className="font-bold text-white">{dates.length > 0 ? formatDate(dates[0]) : 'Never'}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lower Section: Picks Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <Shield className="h-5 w-5 text-cyan-400" />
            Top 10 Picks for Week of {selectedDate ? formatDate(selectedDate) : '...'}
          </h2>
          {loadingPicks && <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />}
        </div>

        {loadingPicks ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            <span className="text-sm text-gray-400">Loading analysis reports...</span>
          </div>
        ) : picks.length === 0 ? (
          <div className="text-center py-16 bg-ramp-grey-900 border border-dashed border-ramp-grey-800 rounded-xl">
            <p className="text-gray-400 text-sm">No analysis picks cached for this date. Trigger a new analysis pipeline above!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {picks.map((pick) => {
              const isBuy = pick.signal.toLowerCase() === 'buy';
              const rankColor = pick.rank === 1 ? 'from-amber-400 to-yellow-500' :
                                pick.rank === 2 ? 'from-slate-300 to-slate-400' :
                                pick.rank === 3 ? 'from-amber-600 to-amber-700' : 
                                'from-cyan-500 to-indigo-500';
                                
              return (
                <Card key={pick.symbol} className="bg-ramp-grey-900 border-ramp-grey-800 text-white shadow-xl hover:border-ramp-grey-700 transition-all duration-300 overflow-hidden flex flex-col">
                  {/* Glowing header showing rank & symbol */}
                  <div className="p-4 border-b border-ramp-grey-800 bg-ramp-grey-950 flex items-center justify-between flex-shrink-0">
                    <div className="flex items-center gap-3">
                      <div className={`h-8 w-8 rounded-full bg-gradient-to-r ${rankColor} flex items-center justify-center font-bold text-white text-sm shadow-md`}>
                        {pick.rank}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-white font-bold text-sm tracking-wide leading-none">{pick.symbol}</span>
                        <span className="text-xs text-gray-400 mt-1 truncate max-w-[200px]">{pick.name}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isBuy ? 'success' : 'warning'} className="text-xs py-0.5 px-2.5">
                        {pick.signal.toUpperCase()}
                      </Badge>
                      <Badge variant="outline" className="text-xs border-cyan-500/20 text-cyan-400 font-semibold">
                        {pick.score}% Conv
                      </Badge>
                    </div>
                  </div>
                  
                  {/* Thesis & metrics */}
                  <CardContent className="p-4 flex-1 flex flex-col gap-4">
                    {/* Metrics Row */}
                    <div className="grid grid-cols-2 gap-3 bg-ramp-grey-950/50 p-2.5 rounded-lg border border-ramp-grey-800/40 text-xs">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">Confidence Score</span>
                        <div className="flex items-center gap-2 mt-1">
                          <div className="w-full bg-gray-800 rounded-full h-1.5 overflow-hidden">
                            <div 
                              className="bg-gradient-to-r from-cyan-400 to-indigo-500 h-1.5 rounded-full" 
                              style={{ width: `${pick.score}%` }}
                            />
                          </div>
                          <span className="font-semibold text-gray-300">{pick.score}%</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider">Risk Rating</span>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-semibold text-gray-200">{pick.risk_score}/10</span>
                          <span className="text-[10px] text-gray-400">
                            {pick.risk_score <= 3 ? '(Low)' : pick.risk_score <= 6 ? '(Med)' : '(High)'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Qualitative Thesis */}
                    <div className="flex-grow">
                      <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold block mb-1.5">Qualitative Thesis</span>
                      <p 
                        className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap bg-ramp-grey-950 p-3 rounded-lg border border-ramp-grey-800/50"
                        dangerouslySetInnerHTML={{ __html: pick.thesis }}
                      />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
