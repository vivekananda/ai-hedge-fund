import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Search, ChevronRight, X, Loader2, TrendingUp, TrendingDown, Activity, Plus, ListPlus, Trash2, Play, Settings, ExternalLink } from 'lucide-react';
import { useWatchlist } from '@/contexts/watchlist-context';
import { ModelSelector } from './ui/llm-selector';
import { apiModels } from '@/data/models';

interface StockFundamental {
  as_of_date: string | null;
  market_cap: number | null;
  pe_ratio: number | null;
  pb_ratio: number | null;
  roe: number | null;
  roce: number | null;
  debt_to_equity: number | null;
  sales_growth_3yr: number | null;
}

interface Stock {
  symbol: string;
  name: string;
  sector: string | null;
  performance_1y: number | null;
  fundamentals: StockFundamental | null;
}

interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8008';

export function Screener() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Search and filter states
  const [search, setSearch] = useState('');
  const [selectedSector, setSelectedSector] = useState('All');
  const [minPerf, setMinPerf] = useState<string>('All');
  const [peFilter, setPeFilter] = useState<string>('All');
  
  // Sorting state
  const sortField = 'market_cap';
  const sortAsc = false;
  
  // Pagination
  const [page, setPage] = useState(1);
  const itemsPerPage = 12;

  // Selected stock details
  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [prices, setPrices] = useState<PricePoint[]>([]);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [chartHoverIndex, setChartHoverIndex] = useState<number | null>(null);

  // Watchlist states
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
    runSimulationOnActive
  } = useWatchlist();

  const [isCreatingList, setIsCreatingList] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  
  // Fetch stocks on mount
  useEffect(() => {
    fetchStocks();
  }, []);

  const fetchStocks = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/stocks`);
      if (!res.ok) throw new Error('Failed to fetch stock list');
      const data = await res.json();
      setStocks(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error loading stock screen data');
    } finally {
      setLoading(false);
    }
  };

  // Fetch prices when selected stock changes
  useEffect(() => {
    if (!selectedStock) {
      setPrices([]);
      return;
    }
    
    const fetchPrices = async () => {
      try {
        setPricesLoading(true);
        const res = await fetch(`${API_BASE_URL}/stocks/${selectedStock.symbol}/prices`);
        if (!res.ok) throw new Error('Failed to fetch prices');
        const data = await res.json();
        setPrices(data);
      } catch (err) {
        console.error('Error fetching stock prices:', err);
      } finally {
        setPricesLoading(false);
      }
    };
    
    fetchPrices();
    setChartHoverIndex(null);
  }, [selectedStock]);

  // Extract unique sectors
  const sectors = useMemo(() => {
    const s = new Set<string>();
    stocks.forEach(stock => {
      if (stock.sector) s.add(stock.sector);
    });
    return ['All', ...Array.from(s).sort()];
  }, [stocks]);

  // Filter and sort stocks
  const filteredStocks = useMemo(() => {
    let result = [...stocks];
    
    // Search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        s => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      );
    }
    
    // Sector
    if (selectedSector !== 'All') {
      result = result.filter(s => s.sector === selectedSector);
    }
    
    // Performance Filter
    if (minPerf !== 'All') {
      if (minPerf === 'positive') {
        result = result.filter(s => (s.performance_1y || 0) > 0);
      } else if (minPerf === 'negative') {
        result = result.filter(s => (s.performance_1y || 0) < 0);
      } else if (minPerf === '30plus') {
        result = result.filter(s => (s.performance_1y || 0) >= 30);
      }
    }

    // PE Filter
    if (peFilter !== 'All') {
      if (peFilter === 'undervalued') {
        result = result.filter(s => s.fundamentals?.pe_ratio && s.fundamentals.pe_ratio < 20);
      } else if (peFilter === 'growth') {
        result = result.filter(s => s.fundamentals?.pe_ratio && s.fundamentals.pe_ratio >= 40);
      }
    }
    
    // Sorting
    result.sort((a, b) => {
      let valA: any = null;
      let valB: any = null;
      
      if (sortField === 'market_cap') {
        valA = a.fundamentals?.market_cap ?? -1;
        valB = b.fundamentals?.market_cap ?? -1;
      } else if (sortField === 'pe_ratio') {
        valA = a.fundamentals?.pe_ratio ?? 999999;
        valB = b.fundamentals?.pe_ratio ?? 999999;
      } else {
        valA = a[sortField] ?? '';
        valB = b[sortField] ?? '';
      }
      
      if (typeof valA === 'string') {
        return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
      }
      
      return sortAsc ? valA - valB : valB - valA;
    });
    
    return result;
  }, [stocks, search, selectedSector, minPerf, peFilter, sortField, sortAsc]);

  // Paginated Stocks
  const paginatedStocks = useMemo(() => {
    const startIndex = (page - 1) * itemsPerPage;
    return filteredStocks.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredStocks, page]);

  const totalPages = Math.ceil(filteredStocks.length / itemsPerPage);

  // Formatter utilities
  const formatMarketCap = (cap: number | null) => {
    if (!cap) return '—';
    if (cap >= 100000) {
      return `₹${(cap / 100000).toFixed(2)} L Cr`;
    }
    return `₹${cap.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`;
  };

  const formatPercent = (val: number | null) => {
    if (val === null || val === undefined) return '—';
    const sign = val > 0 ? '+' : '';
    return `${sign}${val.toFixed(1)}%`;
  };

  // Visual metrics summaries
  const topGainers = useMemo(() => {
    return [...stocks]
      .filter(s => s.performance_1y !== null)
      .sort((a, b) => (b.performance_1y || 0) - (a.performance_1y || 0))
      .slice(0, 3);
  }, [stocks]);

  const topLosers = useMemo(() => {
    return [...stocks]
      .filter(s => s.performance_1y !== null)
      .sort((a, b) => (a.performance_1y || 0) - (b.performance_1y || 0))
      .slice(0, 3);
  }, [stocks]);

  // Custom SVG Area Chart renderer
  const renderSVGChart = useMemo(() => {
    if (prices.length === 0) return null;
    
    const width = 450;
    const height = 180;
    const padding = 20;
    
    const closePrices = prices.map(p => p.close);
    const minClose = Math.min(...closePrices);
    const maxClose = Math.max(...closePrices);
    const priceRange = maxClose - minClose || 1;
    
    // Scale coords
    const points = prices.map((p, idx) => {
      const x = padding + (idx / (prices.length - 1)) * (width - 2 * padding);
      const y = height - padding - ((p.close - minClose) / priceRange) * (height - 2 * padding);
      return { x, y, date: p.date, close: p.close };
    });
    
    // Construct SVG Line Path
    let linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cpX1 = prev.x + (curr.x - prev.x) / 2;
      const cpY1 = prev.y;
      const cpX2 = prev.x + (curr.x - prev.x) / 2;
      const cpY2 = curr.y;
      linePath += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${curr.x} ${curr.y}`;
    }
    
    const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${points[0].x} ${height - padding} Z`;
    
    return {
      points,
      linePath,
      areaPath,
      width,
      height,
      minClose,
      maxClose,
      padding
    };
  }, [prices]);

  // Handle SVG Hover
  const chartRef = useRef<SVGSVGElement>(null);
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!renderSVGChart || !chartRef.current) return;
    
    const rect = chartRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    
    const points = renderSVGChart.points;
    let closestIdx = 0;
    let minDiff = Infinity;
    
    points.forEach((pt, idx) => {
      const diff = Math.abs(pt.x - mouseX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    
    setChartHoverIndex(closestIdx);
  };

  const handleMouseLeave = () => {
    setChartHoverIndex(null);
  };

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

  return (
    <div className="flex h-full w-full bg-ramp-grey-1000 overflow-hidden relative font-sans text-gray-200">
      
      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-ramp-grey-800">
        
        {/* Grid of Highlight Summaries */}
        {!loading && stocks.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6 flex-shrink-0">
            {/* Market Health Summary */}
            <div className="bg-ramp-grey-900 border border-ramp-grey-800 rounded-xl p-4 flex flex-col justify-between shadow-lg">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                  <Activity size={18} />
                </div>
                <div>
                  <h3 className="text-gray-400 text-xs font-semibold uppercase tracking-wider">Screener Universe</h3>
                  <p className="text-white text-lg font-bold mt-0.5">{stocks.length} Top Indian Stocks</p>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-4 text-xs text-gray-400">
                <div>
                  <span className="text-emerald-400 font-semibold">
                    {stocks.filter(s => (s.performance_1y || 0) > 0).length}
                  </span>{' '}
                  Gaining (1Y)
                </div>
                <div className="h-3 w-px bg-ramp-grey-800"></div>
                <div>
                  <span className="text-rose-400 font-semibold">
                    {stocks.filter(s => (s.performance_1y || 0) < 0).length}
                  </span>{' '}
                  Declining (1Y)
                </div>
              </div>
            </div>

            {/* Top Gainers 1Y */}
            <div className="bg-ramp-grey-900 border border-ramp-grey-800 rounded-xl p-4 shadow-lg">
              <div className="flex items-center justify-between mb-3 border-b border-ramp-grey-800 pb-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  <TrendingUp size={14} />
                  <span>Top Gainers (1Y)</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {topGainers.map(s => (
                  <div key={s.symbol} className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-white">{s.symbol.replace('.NS', '')}</span>
                    <span className="text-gray-400 truncate max-w-[120px] text-right">{s.name}</span>
                    <span className="text-emerald-400 font-bold bg-emerald-500/10 px-1.5 py-0.5 rounded">
                      {formatPercent(s.performance_1y)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top Losers 1Y */}
            <div className="bg-ramp-grey-900 border border-ramp-grey-800 rounded-xl p-4 shadow-lg">
              <div className="flex items-center justify-between mb-3 border-b border-ramp-grey-800 pb-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-rose-400">
                  <TrendingDown size={14} />
                  <span>Top Losers (1Y)</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {topLosers.map(s => (
                  <div key={s.symbol} className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-white">{s.symbol.replace('.NS', '')}</span>
                    <span className="text-gray-400 truncate max-w-[120px] text-right">{s.name}</span>
                    <span className="text-rose-400 font-bold bg-rose-500/10 px-1.5 py-0.5 rounded">
                      {formatPercent(s.performance_1y)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Filter Controls Bar */}
        <div className="bg-ramp-grey-900 border border-ramp-grey-800 rounded-xl p-4 mb-6 shadow-md flex-shrink-0 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Search Input */}
            <div className="relative w-full md:w-64">
              <span className="absolute inset-y-0 left-3 flex items-center text-gray-500 pointer-events-none">
                <Search size={16} />
              </span>
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Search symbol or name..."
                className="w-full bg-ramp-grey-1000 border border-ramp-grey-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20"
              />
            </div>

            {/* Sector Select */}
            <div className="w-full md:w-48">
              <select
                value={selectedSector}
                onChange={e => { setSelectedSector(e.target.value); setPage(1); }}
                className="w-full bg-ramp-grey-1000 border border-ramp-grey-800 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20"
              >
                <option value="All">All Sectors</option>
                {sectors.filter(s => s !== 'All').map(sec => (
                  <option key={sec} value={sec}>{sec}</option>
                ))}
              </select>
            </div>

            {/* Performance Select */}
            <div className="w-full md:w-40">
              <select
                value={minPerf}
                onChange={e => { setMinPerf(e.target.value); setPage(1); }}
                className="w-full bg-ramp-grey-1000 border border-ramp-grey-800 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none"
              >
                <option value="All">All Performance</option>
                <option value="positive">Gaining (1Y)</option>
                <option value="negative">Declining (1Y)</option>
                <option value="30plus">Gain &gt; 30%</option>
              </select>
            </div>

            {/* PE Valuation Select */}
            <div className="w-full md:w-40">
              <select
                value={peFilter}
                onChange={e => { setPeFilter(e.target.value); setPage(1); }}
                className="w-full bg-ramp-grey-1000 border border-ramp-grey-800 rounded-lg px-3 py-2 text-xs text-gray-300 focus:outline-none"
              >
                <option value="All">All Valuations</option>
                <option value="undervalued">P/E &lt; 20 (Value)</option>
                <option value="growth">P/E &gt; 40 (Growth)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end md:self-auto text-xs text-gray-400">
            <span>Showing {filteredStocks.length} of {stocks.length}</span>
          </div>
        </div>

        {/* Loading / Error States */}
        {loading && (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-gray-400 gap-3">
            <Loader2 size={32} className="animate-spin text-cyan-400" />
            <span className="text-sm font-medium">Scanning stock universe and loading metrics...</span>
          </div>
        )}

        {error && (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-rose-400 gap-2">
            <span className="font-semibold text-base">Error Loading Data</span>
            <span className="text-xs text-gray-400">{error}</span>
            <button 
              onClick={fetchStocks}
              className="mt-4 px-4 py-2 bg-ramp-grey-850 border border-ramp-grey-700 text-xs text-white rounded-lg hover:bg-ramp-grey-800"
            >
              Retry Load
            </button>
          </div>
        )}

        {/* Interactive Stock Grid Cards & Watchlist Panel */}
        {!loading && !error && (
          <div className="flex-grow flex flex-col lg:flex-row gap-6 items-start">
            
            {/* Grid & Pagination (Main Content) */}
            <div className="flex-grow flex-1 w-full flex flex-col justify-between">
              {filteredStocks.length === 0 ? (
                <div className="text-center py-20 text-gray-400 text-sm">
                  No stocks match your active screen filters.
                </div>
              ) : (
                <div className="flex-grow flex flex-col justify-between">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {paginatedStocks.map(stock => {
                      const isPositive = (stock.performance_1y || 0) >= 0;
                      return (
                        <div
                          key={stock.symbol}
                          onClick={() => setSelectedStock(stock)}
                          className={`bg-ramp-grey-900 border ${selectedStock?.symbol === stock.symbol ? 'border-cyan-500 shadow-cyan-500/5 ring-1 ring-cyan-500/20' : 'border-ramp-grey-800 hover:border-ramp-grey-700'} rounded-xl p-4 transition-all duration-200 cursor-pointer hover:shadow-lg flex flex-col justify-between h-[135px]`}
                        >
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2 min-w-0">
                              <input
                                type="checkbox"
                                checked={isInActiveWatchlist(stock.symbol)}
                                onClick={(e) => e.stopPropagation()} // Prevent card click
                                onChange={async (e) => {
                                  e.stopPropagation();
                                  if (e.target.checked) {
                                    await addTickerToActive(stock.symbol);
                                  } else {
                                    await removeTickerFromActive(stock.symbol);
                                  }
                                }}
                                className="h-3.5 w-3.5 rounded border-ramp-grey-850 text-cyan-600 focus:ring-cyan-500/20 bg-ramp-grey-950 cursor-pointer accent-cyan-500"
                              />
                              <div className="min-w-0">
                                <span className="text-white font-bold tracking-tight text-sm">
                                  {stock.symbol.replace('.NS', '')}
                                </span>
                                <h4 className="text-gray-400 text-[10px] font-medium truncate max-w-[100px] mt-0.5" title={stock.name}>
                                  {stock.name}
                                </h4>
                              </div>
                            </div>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${isPositive ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
                              {formatPercent(stock.performance_1y)}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 border-t border-ramp-grey-950 pt-2.5 mt-2">
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">Mkt Cap</span>
                              <span className="font-bold text-gray-300 text-[11px] truncate">
                                {formatMarketCap(stock.fundamentals?.market_cap ?? null)}
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">P/E Ratio</span>
                              <span className="font-bold text-gray-300 text-[11px]">
                                {stock.fundamentals?.pe_ratio ? stock.fundamentals.pe_ratio.toFixed(1) : '—'}
                              </span>
                            </div>
                            <div className="flex flex-col gap-0.5 min-w-0">
                              <span className="text-[9px] text-gray-500 uppercase tracking-wider font-semibold">ROE %</span>
                              <span className="font-bold text-gray-300 text-[11px]">
                                {stock.fundamentals?.roe ? `${stock.fundamentals.roe.toFixed(1)}%` : '—'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center justify-between text-[9px] text-gray-500 mt-2 pt-1 border-t border-ramp-grey-950/40">
                            <span className="truncate max-w-[140px]">{stock.sector || 'Unassigned'}</span>
                            <span className="text-cyan-400 font-semibold flex items-center gap-0.5 hover:underline flex-shrink-0">
                              View details <ChevronRight size={10} />
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-2 mt-8 mb-4">
                      <button
                        disabled={page === 1}
                        onClick={() => setPage(page - 1)}
                        className="px-3 py-1.5 bg-ramp-grey-900 border border-ramp-grey-800 hover:border-ramp-grey-700 text-xs font-semibold rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Prev
                      </button>
                      <span className="text-xs text-gray-400 font-medium px-2">
                        Page {page} of {totalPages}
                      </span>
                      <button
                        disabled={page === totalPages}
                        onClick={() => setPage(page + 1)}
                        className="px-3 py-1.5 bg-ramp-grey-900 border border-ramp-grey-800 hover:border-ramp-grey-700 text-xs font-semibold rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Watchlist Panel */}
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
                    Select stocks from the grid to build your list.
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
                <span className="inline-block text-xs font-bold text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded mb-2">
                  {selectedStock.sector || 'Unassigned Sector'}
                </span>
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
                      {/* Price hover label overlay */}
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

                      {/* SVG */}
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
                        {/* Define gradients */}
                        <defs>
                          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#06b6d4" stopOpacity="0.0" />
                          </linearGradient>
                        </defs>

                        {/* Grid lines */}
                        <line x1={renderSVGChart.padding} y1={renderSVGChart.height / 2} x2={renderSVGChart.width - renderSVGChart.padding} y2={renderSVGChart.height / 2} stroke="#383838" strokeWidth="0.5" strokeDasharray="3" />
                        <line x1={renderSVGChart.padding} y1={renderSVGChart.height - renderSVGChart.padding} x2={renderSVGChart.width - renderSVGChart.padding} y2={renderSVGChart.height - renderSVGChart.padding} stroke="#383838" strokeWidth="0.5" />

                        {/* Gradient Area under curve */}
                        <path d={renderSVGChart.areaPath} fill="url(#chartGradient)" />

                        {/* Chart Line path */}
                        <path d={renderSVGChart.linePath} fill="none" stroke="#06b6d4" strokeWidth="1.8" />

                        {/* Active hover dot/line */}
                        {chartHoverIndex !== null && renderSVGChart.points[chartHoverIndex] && (
                          <>
                            {/* Vertical tracker line */}
                            <line
                              x1={renderSVGChart.points[chartHoverIndex].x}
                              y1={renderSVGChart.padding}
                              x2={renderSVGChart.points[chartHoverIndex].x}
                              y2={renderSVGChart.height - renderSVGChart.padding}
                              stroke="#06b6d4"
                              strokeWidth="0.5"
                              strokeDasharray="2"
                            />
                            {/* Glowing dot */}
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
                    <p className="text-white text-sm font-bold mt-0.5">
                      {formatMarketCap(selectedStock.fundamentals?.market_cap ?? null)}
                    </p>
                  </div>
                  
                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Price/Earnings (P/E)</span>
                    <p className="text-white text-sm font-bold mt-0.5">
                      {selectedStock.fundamentals?.pe_ratio ? selectedStock.fundamentals.pe_ratio.toFixed(2) : '—'}
                    </p>
                  </div>

                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Price/Book (P/B)</span>
                    <p className="text-white text-sm font-bold mt-0.5">
                      {selectedStock.fundamentals?.pb_ratio ? selectedStock.fundamentals.pb_ratio.toFixed(2) : '—'}
                    </p>
                  </div>

                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Debt to Equity</span>
                    <p className="text-white text-sm font-bold mt-0.5">
                      {selectedStock.fundamentals?.debt_to_equity ? selectedStock.fundamentals.debt_to_equity.toFixed(2) : '—'}
                    </p>
                  </div>

                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Return on Equity (ROE)</span>
                    <p className="text-white text-sm font-bold mt-0.5">
                      {selectedStock.fundamentals?.roe ? `${selectedStock.fundamentals.roe.toFixed(1)}%` : '—'}
                    </p>
                  </div>

                  <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                    <span className="text-[10px] text-gray-500 uppercase font-medium">Sales Growth (3Yr)</span>
                    <p className="text-white text-sm font-bold mt-0.5">
                      {selectedStock.fundamentals?.sales_growth_3yr ? `${selectedStock.fundamentals.sales_growth_3yr.toFixed(1)}%` : '—'}
                    </p>
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
