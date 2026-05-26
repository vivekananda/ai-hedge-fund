import { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, Play, Loader2, Shield, AlertCircle, PlusCircle, MinusCircle, Plus, ListPlus, Trash2, Settings, X, Database, ExternalLink } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { ModelSelector } from './ui/llm-selector';
import { apiModels } from '@/data/models';
import { api, WeeklyPick, WeeklyRun } from '@/services/api';
import { useWatchlist } from '@/contexts/watchlist-context';

export function WeeklyPicksDashboard() {
  const {
    watchlists,
    activeWatchlistName,
    activeWatchlist,
    selectedModel,
    setSelectedModel,
    createWatchlist,
    deleteWatchlist,
    setActiveWatchlistName,
    addTickerToActive,
    removeTickerFromActive,
    isInActiveWatchlist,
    runSimulationOnActive,
    runSimulationOnTicker
  } = useWatchlist();

  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [stocks, setStocks] = useState<any[]>([]);
  const [selectedStock, setSelectedStock] = useState<any | null>(null);
  const [prices, setPrices] = useState<any[]>([]);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [chartHoverIndex, setChartHoverIndex] = useState<number | null>(null);

  // Fetch prices for slide-out drawer
  useEffect(() => {
    if (!selectedStock) {
      setPrices([]);
      return;
    }
    const fetchPrices = async () => {
      try {
        setPricesLoading(true);
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://127.0.0.1:8008'}/stocks/${selectedStock.symbol}/prices`);
        if (res.ok) {
          const data = await res.json();
          setPrices(data);
        }
      } catch (err) {
        console.error('Error fetching stock prices:', err);
      } finally {
        setPricesLoading(false);
      }
    };
    fetchPrices();
    setChartHoverIndex(null);
  }, [selectedStock]);

  const renderSVGChart = useMemo(() => {
    if (prices.length === 0) return null;
    const width = 450, height = 180, padding = 20;
    const closePrices = prices.map(p => p.close);
    const minClose = Math.min(...closePrices);
    const maxClose = Math.max(...closePrices);
    const priceRange = maxClose - minClose || 1;
    const points = prices.map((p, idx) => ({
      x: padding + (idx / (prices.length - 1)) * (width - 2 * padding),
      y: height - padding - ((p.close - minClose) / priceRange) * (height - 2 * padding),
      date: p.date, close: p.close
    }));
    let linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      linePath += ` C ${prev.x + (curr.x - prev.x) / 2} ${prev.y}, ${prev.x + (curr.x - prev.x) / 2} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
    return { points, linePath, areaPath, width, height, minClose, maxClose, padding };
  }, [prices]);

  const chartRef = useRef<SVGSVGElement>(null);
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!renderSVGChart || !chartRef.current) return;
    const rect = chartRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    let closestIdx = 0;
    let minDiff = Infinity;
    renderSVGChart.points.forEach((pt, idx) => {
      const diff = Math.abs(pt.x - mouseX);
      if (diff < minDiff) { minDiff = diff; closestIdx = idx; }
    });
    setChartHoverIndex(closestIdx);
  };
  const handleMouseLeave = () => setChartHoverIndex(null);

  const formatMarketCap = (cap: number | null | undefined) => {
    if (!cap) return '—';
    if (cap >= 100000) return `₹${(cap / 100000).toFixed(2)} L Cr`;
    return `₹${cap.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
  };
  const formatPercent = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;
  };

  // Fetch stocks list to display names inside watchlist
  useEffect(() => {
    const fetchStocks = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://127.0.0.1:8008'}/stocks`);
        if (res.ok) {
          const data = await res.json();
          setStocks(data);
        }
      } catch (err) {
        console.error('Error fetching stock list in weekly picks:', err);
      }
    };
    fetchStocks();
  }, []);

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);
    try {
      await createWatchlist(newListName);
      setNewListName('');
      setIsCreatingList(false);
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create watchlist');
    }
  };

  const handleDeleteActiveList = async () => {
    if (!activeWatchlistName) return;
    if (confirm(`Are you sure you want to delete the watchlist "${activeWatchlistName}"?`)) {
      try {
        await deleteWatchlist(activeWatchlistName);
      } catch (err: any) {
        alert(err.message || 'Failed to delete watchlist');
      }
    }
  };

  const [selectedWatchlist, setSelectedWatchlist] = useState<string>('Nifty 500');
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [picks, setPicks] = useState<WeeklyPick[]>([]);
  const [loadingPicks, setLoadingPicks] = useState(false);
  const [activeRuns, setActiveRuns] = useState<WeeklyRun[]>([]);
  
  // Controls
  const [testMode, setTestMode] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll intervals
  useEffect(() => {
    fetchDates(selectedWatchlist);
    fetchRuns();
    
    // Set up polling for active runs
    const interval = setInterval(() => {
      fetchRuns();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  // Fetch dates when selectedWatchlist changes
  useEffect(() => {
    fetchDates(selectedWatchlist);
  }, [selectedWatchlist]);

  // Fetch picks when selectedDate changes
  useEffect(() => {
    if (selectedDate) {
      fetchPicks(selectedDate, selectedWatchlist);
    } else {
      setPicks([]);
    }
  }, [selectedDate, selectedWatchlist]);

  // If a run just completed and we don't have a date selected, refresh dates
  const isRunning = activeRuns.some(r => r.status === 'RUNNING' || r.status === 'PENDING');
  
  const fetchDates = async (wlName: string = selectedWatchlist) => {
    try {
      const availableDates = await api.getWeeklyPicksDates(wlName);
      setDates(availableDates);
      if (availableDates.length > 0) {
        if (!selectedDate || !availableDates.includes(selectedDate)) {
          setSelectedDate(availableDates[0]);
        }
      } else {
        setSelectedDate('');
      }
    } catch (err) {
      console.error('Error fetching weekly pick dates:', err);
    }
  };

  const fetchPicks = async (date: string, wlName: string = selectedWatchlist) => {
    try {
      setLoadingPicks(true);
      const data = await api.getWeeklyPicks(date, wlName);
      setPicks(data);
    } catch (err) {
      console.error('Error fetching picks:', err);
    } finally {
      setLoadingPicks(false);
    }
  };

  const fetchRuns = async () => {
    try {
      const runs = await api.getWeeklyRuns();
      setActiveRuns(runs);
      
      // If there was a running job that completed, refresh dates
      const completedRun = runs.length > 0 && runs[0].status === 'COMPLETED';
      if (completedRun) {
        fetchDates(selectedWatchlist);
      }
    } catch (err) {
      console.error('Error fetching runs:', err);
    }
  };

  const handleRunPipeline = async () => {
    try {
      setIsTriggering(true);
      setError(null);
      await api.runWeeklyPipeline(
        selectedModel?.model_name || 'gemini-2.0-flash',
        selectedModel?.provider || 'Gemini',
        testMode,
        selectedWatchlist
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

  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const handleSyncData = async () => {
    try {
      setIsSyncing(true);
      setSyncMessage(null);
      const res = await api.syncStocksData();
      setSyncMessage(res.message);
      setTimeout(() => setSyncMessage(null), 5000);
    } catch (err: any) {
      setSyncMessage(err.message || 'Failed to sync data');
      setTimeout(() => setSyncMessage(null), 5000);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-ramp-grey-1000 text-white p-6 space-y-6">
      {/* Upper Grid: Actions & Historical Runs */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Run Pipeline Card */}
        <Card className="bg-ramp-grey-900 border-ramp-grey-800 text-white shadow-xl lg:col-span-2">
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle className="text-white text-lg font-bold flex items-center gap-2">
                <Play className="h-5 w-5 text-cyan-400" />
                Trigger Weekly Analysis Pipeline
              </CardTitle>
              <CardDescription className="text-gray-400 mt-1.5">
                Run the multi-agent hedge fund analyzer across {selectedWatchlist === 'Nifty 500' ? 'Nifty 500 candidate stocks' : `candidate stocks in "${selectedWatchlist}"`}. Technical filters screen down candidates, then qualitative AI agents decide the top 10 buys.
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0 ml-4">
              <Button 
                variant="outline" 
                size="sm" 
                className="bg-ramp-grey-950 border-ramp-grey-800 hover:bg-ramp-grey-800 text-cyan-400"
                onClick={handleSyncData}
                disabled={isSyncing}
              >
                {isSyncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Database className="h-4 w-4 mr-2" />}
                {isSyncing ? 'Triggering Pull...' : 'Pull Latest Data'}
              </Button>
              {syncMessage && (
                <span className="text-[10px] text-cyan-400/80 max-w-[150px] text-right">{syncMessage}</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs text-gray-400 font-semibold tracking-wider uppercase">Select Model</span>
                <ModelSelector
                  models={apiModels}
                  value={selectedModel?.model_name || ""}
                  onChange={setSelectedModel}
                  placeholder="Select LLM model..."
                />
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-gray-400 font-semibold tracking-wider uppercase">Select Universe</span>
                <select
                  value={selectedWatchlist}
                  onChange={(e) => setSelectedWatchlist(e.target.value)}
                  className="w-full bg-ramp-grey-950 border border-ramp-grey-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 h-10"
                >
                  <option value="Nifty 500">Nifty 500 stocks</option>
                  {watchlists.filter(w => w.name !== 'Nifty 500').map(w => (
                    <option key={w.id} value={w.name}>
                      {w.name} ({w.tickers.length} stocks)
                    </option>
                  ))}
                </select>
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
                    Triggered at {new Date(runningJob.created_at).toLocaleTimeString()} ({runningJob.test_mode ? 'Speed Test' : 'Full Ingestion'}) on universe <span className="font-semibold text-cyan-400">{runningJob.watchlist_name || 'Nifty 500'}</span>. This might take 1–2 minutes.
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

            <div className="border-t border-ramp-grey-800 pt-4 space-y-2">
              <span className="text-xs text-gray-400 font-semibold tracking-wider uppercase block">Pipeline Execution Log</span>
              {activeRuns.length === 0 ? (
                <p className="text-[10px] text-gray-500 italic text-center py-2">No pipeline run history</p>
              ) : (
                <div className="flex flex-col gap-2 max-h-[160px] overflow-y-auto scrollbar-thin scrollbar-thumb-ramp-grey-800 pr-1">
                  {activeRuns.slice(0, 4).map((run) => {
                    const statusColor = run.status === 'COMPLETED' ? 'text-emerald-400 bg-emerald-500/10' :
                                      run.status === 'FAILED' ? 'text-rose-400 bg-rose-500/10' :
                                      'text-cyan-400 bg-cyan-500/10 animate-pulse';
                    return (
                      <div key={run.id} className="bg-ramp-grey-950 border border-ramp-grey-850 rounded-lg p-2 text-[10px] space-y-1">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-gray-200">
                            {new Date(run.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} {new Date(run.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded font-mono font-semibold uppercase text-[8px] ${statusColor}`}>
                            {run.status}
                          </span>
                        </div>
                        <div className="flex justify-between text-gray-400 text-[9px]">
                          <span>List: {run.watchlist_name || 'Nifty 500'}</span>
                          <span>{run.test_mode ? 'Speed' : 'Full'}</span>
                        </div>
                        {run.status === 'FAILED' && run.error_message && (
                          <p className="text-rose-400 font-mono text-[8px] bg-red-950/20 p-1 rounded border border-red-900/20 max-w-full break-words mt-1 leading-normal">
                            Error: {run.error_message}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lower Section: Picks Grid */}
      {/* Lower Section: Picks Grid & Watchlist Panel */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        
        {/* Left Side: Top 10 Picks List */}
        <div className="flex-grow flex-1 w-full space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              <Shield className="h-5 w-5 text-cyan-400" />
              Top 10 Picks ({selectedWatchlist}) for Week of {selectedDate ? formatDate(selectedDate) : '...'}
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
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
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
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => {
                                const stockDetail = stocks.find(s => s.symbol === pick.symbol);
                                setSelectedStock(stockDetail || { symbol: pick.symbol, name: pick.name });
                              }}
                              className="text-white font-bold text-sm tracking-wide leading-none hover:text-cyan-400 hover:underline text-left cursor-pointer transition-colors"
                            >
                              {pick.symbol.replace('.NS', '')}
                            </button>
                            {isInActiveWatchlist(pick.symbol) ? (
                              <button
                                onClick={async () => {
                                  await removeTickerFromActive(pick.symbol);
                                }}
                                className="text-rose-400 hover:text-rose-300 p-0.5 rounded transition-colors flex items-center justify-center"
                                title="Remove from watchlist"
                              >
                                <MinusCircle size={13} />
                              </button>
                            ) : (
                              <button
                                onClick={async () => {
                                  await addTickerToActive(pick.symbol);
                                }}
                                className="text-cyan-400 hover:text-cyan-300 p-0.5 rounded transition-colors flex items-center justify-center"
                                title="Add to watchlist"
                              >
                                <PlusCircle size={13} />
                              </button>
                            )}
                          </div>
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
                    <CardContent className="p-4 flex-1 flex flex-col justify-between">
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
                        {/* Left Column: Metrics & Fundamentals (5 cols) */}
                        <div className="md:col-span-5 flex flex-col justify-between gap-3 h-full">
                          <div className="space-y-3">
                            {/* Confidence & Risk */}
                            <div className="grid grid-cols-2 gap-2 bg-ramp-grey-950/50 p-2.5 rounded-lg border border-ramp-grey-800/40 text-xs">
                              <div className="flex flex-col gap-0.5">
                                <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">Confidence</span>
                                <div className="flex items-center gap-1.5 mt-0.5">
                                  <span className="font-bold text-gray-200 text-xs leading-none">{pick.score}%</span>
                                  <div className="w-10 bg-gray-800 rounded-full h-1 overflow-hidden">
                                    <div 
                                      className="bg-gradient-to-r from-cyan-400 to-indigo-500 h-1 rounded-full" 
                                      style={{ width: `${pick.score}%` }}
                                    />
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-col gap-0.5 border-l border-ramp-grey-800/40 pl-2.5">
                                <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">Risk Rating</span>
                                <div className="flex items-center gap-1 mt-0.5">
                                  <span className="font-bold text-gray-200 text-xs leading-none">{pick.risk_score}/10</span>
                                  <span className="text-[9px] text-gray-400 font-medium">
                                    {pick.risk_score <= 3 ? '(Low)' : pick.risk_score <= 6 ? '(Med)' : '(High)'}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Fundamental Ratios Grid */}
                            {(() => {
                              const stockDetail = stocks.find(s => s.symbol === pick.symbol);
                              if (!stockDetail) return (
                                <div className="text-[10px] text-gray-500 italic p-4 text-center bg-ramp-grey-950/20 border border-ramp-grey-800/40 rounded-lg">
                                  No fundamental ratios cached.
                                </div>
                              );
                              return (
                                <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-400">
                                  <div className="bg-ramp-grey-950/40 border border-ramp-grey-800/30 rounded-lg p-2 flex flex-col justify-between">
                                    <span className="text-[9px] text-gray-500 uppercase font-semibold">Market Cap</span>
                                    <span className="font-bold text-gray-200 mt-1">
                                      {formatMarketCap(stockDetail.fundamentals?.market_cap)}
                                    </span>
                                  </div>
                                  <div className="bg-ramp-grey-950/40 border border-ramp-grey-800/30 rounded-lg p-2 flex flex-col justify-between">
                                    <span className="text-[9px] text-gray-500 uppercase font-semibold">1Y Return</span>
                                    <span className={`font-bold mt-1 ${stockDetail.performance_1y && stockDetail.performance_1y >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {formatPercent(stockDetail.performance_1y)}
                                    </span>
                                  </div>
                                  <div className="bg-ramp-grey-950/40 border border-ramp-grey-800/30 rounded-lg p-2 flex flex-col justify-between">
                                    <span className="text-[9px] text-gray-500 uppercase font-semibold">P/E Ratio</span>
                                    <span className="font-bold text-gray-200 mt-1">
                                      {stockDetail.fundamentals?.pe_ratio ? stockDetail.fundamentals.pe_ratio.toFixed(1) : '—'}
                                    </span>
                                  </div>
                                  <div className="bg-ramp-grey-950/40 border border-ramp-grey-800/30 rounded-lg p-2 flex flex-col justify-between">
                                    <span className="text-[9px] text-gray-500 uppercase font-semibold">ROE %</span>
                                    <span className="font-bold text-gray-200 mt-1">
                                      {stockDetail.fundamentals?.roe ? `${stockDetail.fundamentals.roe.toFixed(1)}%` : '—'}
                                    </span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>

                          {/* Sector at the bottom of left column */}
                          {(() => {
                            const stockDetail = stocks.find(s => s.symbol === pick.symbol);
                            if (!stockDetail || !stockDetail.sector) return null;
                            return (
                              <div className="text-[10px] text-gray-500 mt-auto border-t border-ramp-grey-800/40 pt-2 flex items-center justify-between">
                                <span>Sector</span>
                                <span className="font-semibold text-gray-300 truncate max-w-[125px]" title={stockDetail.sector}>
                                  {stockDetail.sector}
                                </span>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Right Column: Qualitative Thesis (7 cols) */}
                        <div className="md:col-span-7 flex flex-col h-full justify-between gap-1.5">
                          <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold block">Qualitative Thesis</span>
                          <div className="flex-1 min-h-[140px] max-h-[185px] overflow-y-auto bg-ramp-grey-950 p-2.5 rounded-lg border border-ramp-grey-800/50 scrollbar-thin scrollbar-thumb-ramp-grey-800 text-[11px] text-gray-300 leading-relaxed">
                            <div 
                              className="whitespace-pre-wrap"
                              dangerouslySetInnerHTML={{ __html: pick.thesis }}
                            />
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: Watchlist Panel */}
        {!loadingPicks && (
          <div className="w-full lg:w-80 bg-ramp-grey-900 border border-ramp-grey-800 rounded-xl p-4 shadow-xl flex flex-col gap-4 self-start flex-shrink-0">
            <div className="flex items-center justify-between border-b border-ramp-grey-800 pb-2">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-cyan-400">
                <ListPlus size={16} />
                <span>My Watchlists</span>
              </div>
            </div>

            {/* List Selector / Creator */}
            <div className="space-y-2">
              {isCreatingList ? (
                <form onSubmit={handleCreateList} className="space-y-2">
                  <input
                    type="text"
                    placeholder="List name (e.g. Growth)"
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    className="w-full bg-ramp-grey-1000 border border-ramp-grey-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500"
                    autoFocus
                  />
                  {createError && <p className="text-[10px] text-rose-400">{createError}</p>}
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      className="flex-1 bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-1 px-2 rounded text-[10px] transition-all"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setIsCreatingList(false); setCreateError(null); }}
                      className="flex-1 bg-ramp-grey-850 hover:bg-ramp-grey-800 text-gray-400 font-bold py-1 px-2 rounded text-[10px] transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={activeWatchlistName || ''}
                      onChange={(e) => setActiveWatchlistName(e.target.value || null)}
                      className="flex-1 bg-ramp-grey-1000 border border-ramp-grey-800 rounded-lg px-2.5 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-cyan-500"
                    >
                      {watchlists.length === 0 ? (
                        <option value="">No lists saved</option>
                      ) : (
                        watchlists.map((w) => (
                          <option key={w.id} value={w.name}>
                            {w.name}
                          </option>
                        ))
                      )}
                    </select>
                    <button
                      onClick={() => setIsCreatingList(true)}
                      className="bg-ramp-grey-850 hover:bg-ramp-grey-800 border border-ramp-grey-800 text-gray-300 p-1.5 rounded-lg text-xs hover:text-white transition-all flex items-center justify-center"
                      title="Create New List"
                    >
                      <Plus size={14} />
                    </button>
                    {activeWatchlistName && (
                      <button
                        onClick={handleDeleteActiveList}
                        className="bg-ramp-grey-850 hover:bg-ramp-grey-800 border border-ramp-grey-800 text-gray-400 p-1.5 rounded-lg text-xs hover:text-rose-400 transition-all flex items-center justify-center"
                        title="Delete Current List"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Watchlist Tickers List */}
            <div className="flex-1 min-h-[150px] max-h-[300px] overflow-y-auto bg-ramp-grey-1000 border border-ramp-grey-850 rounded-xl p-3 scrollbar-thin scrollbar-thumb-ramp-grey-800 flex flex-col">
              {!activeWatchlist || activeWatchlist.tickers.length === 0 ? (
                <div className="flex-grow flex items-center justify-center text-center text-[10px] text-gray-500 p-4">
                  Select stocks from Weekly Picks or Screener to build your list.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {activeWatchlist.tickers.map((ticker) => {
                    const stockDetail = stocks.find(s => s.symbol === ticker);
                    return (
                      <div key={ticker} className="flex justify-between items-center text-xs bg-ramp-grey-950/40 border border-ramp-grey-900 rounded px-2.5 py-1.5 hover:border-ramp-grey-800 transition-colors">
                        <div className="flex flex-col min-w-0">
                          <span className="font-bold text-white leading-none">{ticker.replace('.NS', '')}</span>
                          <span className="text-[9px] text-gray-500 truncate mt-0.5 max-w-[150px]">
                            {stockDetail?.name || ticker}
                          </span>
                        </div>
                        <button
                          onClick={() => removeTickerFromActive(ticker)}
                          className="text-gray-500 hover:text-rose-400 p-0.5 rounded transition-all hover:bg-ramp-grey-900 flex items-center justify-center"
                          title="Remove from list"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Simulation configuration */}
            {activeWatchlist && activeWatchlist.tickers.length > 0 && (
              <div className="border-t border-ramp-grey-850 pt-3 space-y-3">
                <div className="space-y-1.5">
                  <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold flex items-center gap-1">
                    <Settings size={10} /> Choose Model
                  </span>
                  <ModelSelector
                    models={apiModels}
                    value={selectedModel?.model_name || ''}
                    onChange={setSelectedModel}
                    placeholder="Select simulation model..."
                  />
                </div>
                
                <button
                  onClick={() => runSimulationOnActive(selectedModel)}
                  className="w-full flex items-center justify-center gap-1.5 bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold py-2 rounded-lg text-xs transition-all shadow-lg shadow-indigo-600/10 active:scale-[0.98]"
                >
                  <Play size={14} className="fill-current" /> Run Simulation ({activeWatchlist.tickers.length})
                </button>
              </div>
            )}
          </div>
        )}

      </div>

      {/* Slide-out details drawer */}
      <div className={`fixed top-[57px] right-0 bottom-0 z-30 w-[460px] bg-ramp-grey-900 border-l border-ramp-grey-800 transform ${selectedStock ? 'translate-x-0' : 'translate-x-full'} transition-transform duration-300 ease-in-out shadow-2xl flex flex-col justify-between`}>
        {selectedStock && (
          <div className="flex flex-col h-full">
            {/* Drawer Header */}
            <div className="p-5 border-b border-ramp-grey-800 flex justify-between items-start flex-shrink-0 bg-ramp-grey-900/50 backdrop-blur-md">
              <div>
                <div className="flex flex-wrap gap-2 mb-2">
                  <span className="inline-block text-xs font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">
                    {selectedStock.sector || 'Unassigned Sector'}
                  </span>
                  {selectedStock.rs_rating !== undefined && selectedStock.rs_rating !== null && (
                    <span className="inline-block text-xs font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20" title="Relative Strength Rating (1-99)">
                      RS {Math.round(selectedStock.rs_rating)}
                    </span>
                  )}
                  {selectedStock.is_minervini_trend && (
                    <span className="inline-block text-xs font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      Minervini Stage 2
                    </span>
                  )}
                  {selectedStock.is_canslim && (
                    <span className="inline-block text-xs font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                      CANSLIM Leader
                    </span>
                  )}
                </div>
                <h2 className="text-white text-lg font-bold leading-tight flex items-center gap-2">
                  {selectedStock.symbol.replace('.NS', '')}
                  <a 
                    href={`https://www.screener.in/company/${selectedStock.symbol.replace('.NS', '')}/`}
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-cyan-400 transition-colors"
                    title="Open in Screener.in"
                  >
                    <ExternalLink size={16} />
                  </a>
                </h2>
                <h3 className="text-gray-400 text-xs mt-1 font-medium">{selectedStock.name}</h3>
              </div>
              <button
                onClick={() => setSelectedStock(null)}
                className="text-gray-400 hover:text-white p-1 hover:bg-ramp-grey-800 rounded transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin scrollbar-thumb-ramp-grey-800">
              
              {/* Quick AI Analyze shortcut */}
              <div className="bg-ramp-grey-950/60 border border-ramp-grey-800/60 rounded-xl p-4.5 flex flex-col gap-2.5 shadow-md">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-cyan-400 uppercase tracking-wider font-bold block leading-none">AI Agent Workspace</span>
                </div>
                <p className="text-[11px] text-gray-400 leading-normal">
                  Instantly switch to the Simulation workspace and run multi-agent analyses on this stock.
                </p>
                <Button
                  onClick={() => {
                    runSimulationOnTicker(selectedStock.symbol, selectedModel);
                    setSelectedStock(null);
                  }}
                  className="w-full bg-gradient-to-tr from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-bold py-2 rounded-lg text-xs transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-[0.98]"
                >
                  <Play size={13} className="fill-current" /> Analyze with AI Agents
                </Button>
              </div>

              {/* Glowing SVG Price Chart */}
              <div>
                <h3 className="text-white text-xs font-semibold uppercase tracking-wider mb-3">1-Year Close Price Chart</h3>
                <div className="bg-ramp-grey-1000 border border-ramp-grey-800 rounded-xl p-3 h-52 relative flex items-center justify-center shadow-inner overflow-hidden">
                  {pricesLoading && (
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <Loader2 size={24} className="animate-spin text-cyan-400" />
                      <span className="text-[10px]">Loading price series...</span>
                    </div>
                  )}
                  {!pricesLoading && prices.length === 0 && (
                    <span className="text-xs text-gray-500">Price history not available for this stock.</span>
                  )}
                  {!pricesLoading && prices.length > 0 && renderSVGChart && (
                    <div className="w-full h-full flex flex-col justify-between">
                      <div className="flex justify-between items-center text-[10px] font-semibold text-gray-400 border-b border-ramp-grey-800/40 pb-1 mb-1">
                        <span>
                          {chartHoverIndex !== null 
                            ? `Date: ${renderSVGChart.points[chartHoverIndex].date}`
                            : `Range: ${prices[0].date} to ${prices[prices.length - 1].date}`
                          }
                        </span>
                        <span className="text-cyan-400 font-bold">
                          {chartHoverIndex !== null
                            ? `₹${renderSVGChart.points[chartHoverIndex].close.toFixed(2)}`
                            : `Last: ₹${prices[prices.length - 1].close.toFixed(2)}`
                          }
                        </span>
                      </div>
                      <svg
                        ref={chartRef}
                        width="100%"
                        height="145"
                        viewBox={`0 0 ${renderSVGChart.width} ${renderSVGChart.height}`}
                        preserveAspectRatio="none"
                        onMouseMove={handleMouseMove}
                        onMouseLeave={handleMouseLeave}
                        className="overflow-visible cursor-crosshair"
                      >
                        <defs>
                          <linearGradient id="chartGradient2" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>
                        <line x1={renderSVGChart.padding} y1={renderSVGChart.height / 2} x2={renderSVGChart.width - renderSVGChart.padding} y2={renderSVGChart.height / 2} stroke="#383838" strokeWidth="0.5" strokeDasharray="3" />
                        <line x1={renderSVGChart.padding} y1={renderSVGChart.height - renderSVGChart.padding} x2={renderSVGChart.width - renderSVGChart.padding} y2={renderSVGChart.height - renderSVGChart.padding} stroke="#383838" strokeWidth="0.5" />
                        <path d={renderSVGChart.areaPath} fill="url(#chartGradient2)" />
                        <path d={renderSVGChart.linePath} fill="none" stroke="#06b6d4" strokeWidth="1.8" />
                        {chartHoverIndex !== null && renderSVGChart.points[chartHoverIndex] && (
                          <>
                            <line
                              x1={renderSVGChart.points[chartHoverIndex].x}
                              y1={renderSVGChart.padding}
                              x2={renderSVGChart.points[chartHoverIndex].x}
                              y2={renderSVGChart.height - renderSVGChart.padding}
                              stroke="#06b6d4"
                              strokeWidth="0.5"
                              strokeDasharray="2"
                            />
                            <circle
                              cx={renderSVGChart.points[chartHoverIndex].x}
                              cy={renderSVGChart.points[chartHoverIndex].y}
                              r="5"
                              fill="#06b6d4"
                              stroke="#1e1e1e"
                              strokeWidth="1.5"
                            />
                          </>
                        )}
                      </svg>
                    </div>
                  )}
                </div>
              </div>

              {/* Fundamental Metrics list */}
              <div>
                <h3 className="text-white text-xs font-semibold uppercase tracking-wider mb-3">Fundamental Ratios</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Market Cap</span>
                    <p className="text-white text-sm font-bold mt-0.5">{formatMarketCap(selectedStock.fundamentals?.market_cap)}</p>
                  </div>
                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Price/Earnings (P/E)</span>
                    <p className="text-white text-sm font-bold mt-0.5">{selectedStock.fundamentals?.pe_ratio ? selectedStock.fundamentals.pe_ratio.toFixed(2) : '—'}</p>
                  </div>
                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Price/Book (P/B)</span>
                    <p className="text-white text-sm font-bold mt-0.5">{selectedStock.fundamentals?.pb_ratio ? selectedStock.fundamentals.pb_ratio.toFixed(2) : '—'}</p>
                  </div>
                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Debt to Equity</span>
                    <p className="text-white text-sm font-bold mt-0.5">{selectedStock.fundamentals?.debt_to_equity ? selectedStock.fundamentals.debt_to_equity.toFixed(2) : '—'}</p>
                  </div>
                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Return on Equity (ROE)</span>
                    <p className="text-white text-sm font-bold mt-0.5">{selectedStock.fundamentals?.roe ? `${selectedStock.fundamentals.roe.toFixed(1)}%` : '—'}</p>
                  </div>
                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Sales Growth (3Yr)</span>
                    <p className="text-white text-sm font-bold mt-0.5">{selectedStock.fundamentals?.sales_growth_3yr ? `${selectedStock.fundamentals.sales_growth_3yr.toFixed(1)}%` : '—'}</p>
                  </div>
                </div>
              </div>
            </div>
            {/* Drawer Footer info */}
            <div className="p-4 border-t border-ramp-grey-800 text-[10px] text-gray-500 text-center bg-ramp-grey-950/20">
              Data retrieved from Yahoo Finance & local database • As of {selectedStock.fundamentals?.as_of_date || '—'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
