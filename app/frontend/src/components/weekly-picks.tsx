import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Calendar, Play, Loader2, Shield, AlertCircle, PlusCircle, MinusCircle, Plus, ListPlus, Trash2, Settings, X, Database, ExternalLink, FileImage, FileText, Sparkles } from 'lucide-react';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { ModelSelector } from './ui/llm-selector';
import { DEFAULT_MODEL_NAME, getModels, LanguageModel } from '@/data/models';
import { api, WeeklyPick, WeeklyRun } from '@/services/api';
import { useWatchlist } from '@/contexts/watchlist-context';

type AgentSignalTone = 'bullish' | 'bearish' | 'neutral' | 'risk' | 'summary' | 'unknown';

interface AgentThesisSection {
  agent?: string;
  signal?: string;
  confidence?: number;
  bullets?: string[];
}

interface StockPricePoint {
  date: string;
  close: number;
}

interface HistoricalPriceComparison {
  label: string;
  targetDate: string;
  actualDate?: string;
  price?: number;
  percentFromThen?: number;
}

const AGENT_SIGNAL_LEGEND: { tone: AgentSignalTone; label: string; className: string }[] = [
  { tone: 'bullish', label: 'Bullish / Buy', className: 'bg-emerald-400' },
  { tone: 'bearish', label: 'Bearish / Sell', className: 'bg-rose-400' },
  { tone: 'neutral', label: 'Neutral / Hold', className: 'bg-amber-300' },
  { tone: 'risk', label: 'Risk', className: 'bg-violet-300' },
  { tone: 'unknown', label: 'Other', className: 'bg-slate-400' },
];

let isMermaidInitialized = false;
let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null;

function loadMermaid() {
  mermaidModulePromise = mermaidModulePromise || import('mermaid');
  return mermaidModulePromise;
}

function getAgentSections(pick: WeeklyPick): AgentThesisSection[] {
  const sections = pick.analysis_details?.agent_sections;
  return Array.isArray(sections) ? sections : [];
}

function getIntrinsicValue(pick: WeeklyPick) {
  return pick.analysis_details?.intrinsic_value || null;
}

function getAnalysisError(pick: WeeklyPick) {
  const error = pick.analysis_details?.analysis_error;
  return error?.message ? error : null;
}

function getSignalTone(signal?: string, agentName?: string): AgentSignalTone {
  const normalizedSignal = (signal || '').toLowerCase();
  const normalizedAgent = (agentName || '').toLowerCase();

  if (normalizedSignal.includes('bull') || normalizedSignal.includes('buy') || normalizedSignal.includes('long') || normalizedSignal.includes('low')) {
    return 'bullish';
  }

  if (normalizedSignal.includes('bear') || normalizedSignal.includes('sell') || normalizedSignal.includes('short') || normalizedSignal.includes('high')) {
    return 'bearish';
  }

  if (normalizedSignal.includes('neutral') || normalizedSignal.includes('hold') || normalizedSignal.includes('medium')) {
    return 'neutral';
  }

  if (normalizedAgent.includes('risk')) {
    return 'risk';
  }

  return 'unknown';
}

function escapeMermaidLabel(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '(')
    .replace(/\]/g, ')')
    .replace(/\|/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatAgentConfidence(confidence: unknown): string {
  if (typeof confidence !== 'number' || Number.isNaN(confidence)) {
    return 'n/a';
  }

  const normalized = confidence > 0 && confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(normalized)}%`;
}

function getCanvasToneColors(tone: AgentSignalTone) {
  switch (tone) {
    case 'bullish':
      return { fill: '#064e3b', stroke: '#34d399', text: '#ecfdf5', subtext: '#a7f3d0' };
    case 'bearish':
      return { fill: '#7f1d1d', stroke: '#fb7185', text: '#fff1f2', subtext: '#fecdd3' };
    case 'neutral':
      return { fill: '#451a03', stroke: '#fbbf24', text: '#fffbeb', subtext: '#fde68a' };
    case 'risk':
      return { fill: '#581c87', stroke: '#c084fc', text: '#faf5ff', subtext: '#e9d5ff' };
    case 'summary':
      return { fill: '#083344', stroke: '#22d3ee', text: '#ecfeff', subtext: '#a5f3fc' };
    default:
      return { fill: '#1e293b', stroke: '#94a3b8', text: '#f8fafc', subtext: '#cbd5e1' };
  }
}

function buildAgentThesisDiagram(pick: WeeklyPick): string | null {
  const sections = getAgentSections(pick);
  if (sections.length === 0) {
    return null;
  }

  const portfolioTone = getSignalTone(pick.signal);
  const symbol = escapeMermaidLabel(pick.symbol.replace('.NS', ''));
  const signal = escapeMermaidLabel(pick.signal.toUpperCase());
  const conviction = escapeMermaidLabel(`${pick.score}% conviction`);
  const riskScore = escapeMermaidLabel(`Risk ${pick.risk_score}/10`);
  const lines = [
    'flowchart LR',
    '  stock["Screened Stock<br/>' + symbol + '"]:::summary',
    '  portfolio["Portfolio Decision<br/>' + signal + '<br/>' + conviction + '"]:::' + portfolioTone,
    '  risk["Risk Review<br/>' + riskScore + '"]:::risk',
    '  portfolio --> risk',
  ];

  sections.forEach((section, index) => {
    const nodeId = `agent${index}`;
    const tone = getSignalTone(section.signal, section.agent);
    const agent = escapeMermaidLabel(section.agent || `Agent ${index + 1}`);
    const sectionSignal = escapeMermaidLabel(section.signal || 'n/a');
    const confidence = escapeMermaidLabel(formatAgentConfidence(section.confidence));
    lines.push(`  ${nodeId}["${agent}<br/>${sectionSignal} - ${confidence}"]:::${tone}`);
    lines.push(`  stock --> ${nodeId}`);
    lines.push(`  ${nodeId} --> portfolio`);
  });

  lines.push(
    '  classDef bullish fill:#064e3b,stroke:#34d399,color:#ecfdf5,stroke-width:2px;',
    '  classDef bearish fill:#7f1d1d,stroke:#fb7185,color:#fff1f2,stroke-width:2px;',
    '  classDef neutral fill:#451a03,stroke:#fbbf24,color:#fffbeb,stroke-width:2px;',
    '  classDef risk fill:#581c87,stroke:#c084fc,color:#faf5ff,stroke-width:2px;',
    '  classDef summary fill:#083344,stroke:#22d3ee,color:#ecfeff,stroke-width:2px;',
    '  classDef unknown fill:#1e293b,stroke:#94a3b8,color:#f8fafc,stroke-width:2px;'
  );

  return lines.join('\n');
}

function AgentThesisMermaidDiagram({ pick }: { pick: WeeklyPick }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const renderIdRef = useRef(`agent-thesis-${pick.id}-${Math.random().toString(36).slice(2)}`);
  const diagram = useMemo(() => buildAgentThesisDiagram(pick), [pick]);
  const hasAgentSections = getAgentSections(pick).length > 0;

  useEffect(() => {
    if (!diagram || !containerRef.current) {
      return;
    }

    let isCancelled = false;

    const renderDiagram = async () => {
      try {
        const mermaid = (await loadMermaid()).default;
        if (!isMermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'loose',
            theme: 'base',
            flowchart: {
              curve: 'basis',
              htmlLabels: true,
              nodeSpacing: 42,
              rankSpacing: 58,
            },
          });
          isMermaidInitialized = true;
        }

        const { svg } = await mermaid.render(`${renderIdRef.current}-${Date.now()}`, diagram);
        if (!isCancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      } catch (err) {
        console.error('Failed to render thesis Mermaid diagram:', err);
        if (!isCancelled && containerRef.current) {
          containerRef.current.innerHTML = '<p class="text-xs text-rose-300">Unable to render agent diagram for this analysis.</p>';
        }
      }
    };

    renderDiagram();

    return () => {
      isCancelled = true;
    };
  }, [diagram]);

  if (!hasAgentSections) {
    return (
      <div className="rounded-lg border border-ramp-grey-800 bg-ramp-grey-950/70 p-3 text-xs text-gray-400">
        No structured agent outputs were stored for this pick, so the thesis diagram cannot be generated.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-ramp-grey-800 bg-ramp-grey-950 p-3">
        <div ref={containerRef} className="min-w-[720px] [&_svg]:mx-auto [&_svg]:max-w-none" />
      </div>
      <div className="flex flex-wrap gap-2">
        {AGENT_SIGNAL_LEGEND.map((item) => (
          <span key={item.tone} className="inline-flex items-center gap-1.5 rounded-full border border-ramp-grey-800 bg-ramp-grey-950 px-2 py-1 text-[10px] font-medium text-gray-300">
            <span className={`h-2 w-2 rounded-full ${item.className}`} />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function WeeklyPicksDashboard() {
  const [models, setModels] = useState<LanguageModel[]>([]);

  useEffect(() => {
    const fetchModelsList = async () => {
      try {
        const list = await getModels();
        setModels(list);
      } catch (err) {
        console.error('Error fetching models list:', err);
      }
    };
    fetchModelsList();
  }, []);

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
  const [manualTicker, setManualTicker] = useState('');
  const [manualTickerError, setManualTickerError] = useState<string | null>(null);
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
  const formatPrice = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return `₹${val.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };
  const formatIntrinsicPrice = (val: number | null | undefined, currency?: string | null) => {
    if (val === null || val === undefined) return '—';
    const prefix = currency && currency !== 'INR' ? `${currency} ` : '₹';
    return `${prefix}${val.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };
  const formatMarginOfSafety = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '—';
    return `${val >= 0 ? '+' : ''}${(val * 100).toFixed(1)}% MoS`;
  };
  const getMarginToneClass = (val: number | null | undefined) => {
    if (val === null || val === undefined) return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
    if (val >= 0.25) return 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25';
    if (val >= 0) return 'text-cyan-300 bg-cyan-500/10 border-cyan-500/25';
    return 'text-rose-300 bg-rose-500/10 border-rose-500/25';
  };
  const formatMethodSource = (method?: string | null, source?: string | null) => {
    const methodLabel = method ? method.replace(/_/g, ' ') : 'method n/a';
    return source ? `${methodLabel} · ${source}` : methodLabel;
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

  const handleAddManualTicker = async (e: React.FormEvent) => {
    e.preventDefault();
    setManualTickerError(null);
    try {
      await addTickerToActive(manualTicker);
      setManualTicker('');
    } catch (err: any) {
      setManualTickerError(err.message || 'Failed to add ticker');
    }
  };

  const [selectedWatchlist, setSelectedWatchlist] = useState<string>('Nifty 500');
  const [dates, setDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const selectedWatchlistRef = useRef(selectedWatchlist);
  const selectedDateRef = useRef(selectedDate);
  const [picks, setPicks] = useState<WeeklyPick[]>([]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<WeeklyPick | null>(null);
  const [analysisPrices, setAnalysisPrices] = useState<StockPricePoint[]>([]);
  const [analysisPricesLoading, setAnalysisPricesLoading] = useState(false);
  const [loadingPicks, setLoadingPicks] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<'png' | 'pdf' | null>(null);
  const [exportingSingleFormat, setExportingSingleFormat] = useState<'png' | 'pdf' | null>(null);
  const [activeRuns, setActiveRuns] = useState<WeeklyRun[]>([]);
  
  // Controls
  const [testMode, setTestMode] = useState(true);
  const [isTriggering, setIsTriggering] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    selectedWatchlistRef.current = selectedWatchlist;
  }, [selectedWatchlist]);

  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  useEffect(() => {
    if (!selectedAnalysis) {
      setAnalysisPrices([]);
      return;
    }

    let isCancelled = false;

    const fetchAnalysisPrices = async () => {
      try {
        setAnalysisPricesLoading(true);
        const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://127.0.0.1:8008'}/stocks/${selectedAnalysis.symbol}/prices`);
        if (!res.ok) {
          throw new Error('Failed to fetch analysis price history');
        }
        const data = await res.json();
        if (!isCancelled) {
          setAnalysisPrices(data);
        }
      } catch (err) {
        console.error('Error fetching analysis stock prices:', err);
        if (!isCancelled) {
          setAnalysisPrices([]);
        }
      } finally {
        if (!isCancelled) {
          setAnalysisPricesLoading(false);
        }
      }
    };

    fetchAnalysisPrices();

    return () => {
      isCancelled = true;
    };
  }, [selectedAnalysis]);

  const historicalPriceComparisons = useMemo<HistoricalPriceComparison[]>(() => {
    if (!selectedAnalysis) {
      return [];
    }

    if (analysisPrices.length === 0) {
      return [];
    }

    const latestPricePoint = analysisPrices[analysisPrices.length - 1];
    const currentPrice = selectedAnalysis.current_price ?? latestPricePoint?.close;
    const currentDateValue = (selectedAnalysis.current_date || latestPricePoint?.date || new Date().toISOString().slice(0, 10)).slice(0, 10);

    if (!currentPrice || currentPrice <= 0 || !currentDateValue) {
      return [];
    }

    const currentDate = new Date(`${currentDateValue}T00:00:00`);
    if (Number.isNaN(currentDate.getTime())) {
      return [];
    }

    const getTargetDate = (amount: number, unit: 'month' | 'week') => {
      const target = new Date(currentDate);
      if (unit === 'month') {
        target.setMonth(target.getMonth() - amount);
      } else {
        target.setDate(target.getDate() - amount * 7);
      }
      return target;
    };

    const formatDateValue = (date: Date) => date.toISOString().slice(0, 10);

    const findNearestPriceOnOrBefore = (targetDate: Date) => {
      const targetTime = targetDate.getTime();
      for (let idx = analysisPrices.length - 1; idx >= 0; idx -= 1) {
        const point = analysisPrices[idx];
        const pointTime = new Date(`${point.date}T00:00:00`).getTime();
        if (!Number.isNaN(pointTime) && pointTime <= targetTime) {
          return point;
        }
      }
      return undefined;
    };

    return [
      { label: '3 months ago', amount: 3, unit: 'month' as const },
      { label: '2 months ago', amount: 2, unit: 'month' as const },
      { label: '1 month ago', amount: 1, unit: 'month' as const },
      { label: '3 weeks ago', amount: 3, unit: 'week' as const },
      { label: '2 weeks ago', amount: 2, unit: 'week' as const },
      { label: '1 week ago', amount: 1, unit: 'week' as const },
    ].map(({ label, amount, unit }) => {
      const targetDate = getTargetDate(amount, unit);
      const pricePoint = findNearestPriceOnOrBefore(targetDate);
      const percentFromThen = pricePoint?.close ? ((currentPrice - pricePoint.close) / pricePoint.close) * 100 : undefined;

      return {
        label,
        targetDate: formatDateValue(targetDate),
        actualDate: pricePoint?.date,
        price: pricePoint?.close,
        percentFromThen,
      };
    });
  }, [analysisPrices, selectedAnalysis]);

  const fetchDates = useCallback(async (wlName: string = selectedWatchlistRef.current) => {
    try {
      const availableDates = await api.getWeeklyPicksDates(wlName);
      setDates(availableDates);
      const currentSelectedDate = selectedDateRef.current;
      if (availableDates.length > 0) {
        if (!currentSelectedDate || !availableDates.includes(currentSelectedDate)) {
          setSelectedDate(availableDates[0]);
        }
      } else {
        setSelectedDate('');
      }
    } catch (err) {
      console.error('Error fetching weekly pick dates:', err);
    }
  }, []);

  const fetchPicks = useCallback(async (date: string, wlName: string = selectedWatchlistRef.current) => {
    try {
      setLoadingPicks(true);
      const data = await api.getWeeklyPicks(date, wlName);
      setPicks(data);
    } catch (err) {
      console.error('Error fetching picks:', err);
    } finally {
      setLoadingPicks(false);
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const runs = await api.getWeeklyRuns();
      setActiveRuns(runs);
      
      // If there was a running job that completed, refresh dates
      const completedRun = runs.length > 0 && runs[0].status === 'COMPLETED';
      if (completedRun) {
        fetchDates(selectedWatchlistRef.current);
      }
    } catch (err) {
      console.error('Error fetching runs:', err);
    }
  }, [fetchDates]);

  // Poll intervals
  useEffect(() => {
    fetchDates(selectedWatchlistRef.current);
    fetchRuns();
    
    // Set up polling for active runs
    const interval = setInterval(() => {
      fetchRuns();
    }, 5000);

    return () => clearInterval(interval);
  }, [fetchDates, fetchRuns]);

  // Fetch dates when selectedWatchlist changes
  useEffect(() => {
    fetchDates(selectedWatchlist);
  }, [fetchDates, selectedWatchlist]);

  // Fetch picks when selectedDate changes
  useEffect(() => {
    if (selectedDate) {
      fetchPicks(selectedDate, selectedWatchlist);
    } else {
      setPicks([]);
    }
  }, [fetchPicks, selectedDate, selectedWatchlist]);

  // If a run just completed and we don't have a date selected, refresh dates
  const isRunning = activeRuns.some(r => r.status === 'RUNNING' || r.status === 'PENDING');

  const openHistoricalRun = (run: WeeklyRun) => {
    const runWatchlist = run.watchlist_name || 'Nifty 500';
    selectedWatchlistRef.current = runWatchlist;
    selectedDateRef.current = run.run_date;
    setSelectedWatchlist(runWatchlist);
    setSelectedDate(run.run_date);
    fetchDates(runWatchlist);
    fetchPicks(run.run_date, runWatchlist);
  };

  const handleRunPipeline = async () => {
    try {
      setIsTriggering(true);
      setError(null);
      await api.runWeeklyPipeline(
        selectedModel?.model_name || DEFAULT_MODEL_NAME,
        selectedModel?.provider || 'OpenRouter',
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

  const handleCancelPipeline = async (runId: number) => {
    try {
      setIsCancelling(true);
      setError(null);
      await api.cancelWeeklyPipeline(runId);
      await fetchRuns();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel weekly picks pipeline');
    } finally {
      setIsCancelling(false);
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

  const getExportFileBase = () => {
    const datePart = selectedDate || new Date().toISOString().slice(0, 10);
    const watchlistPart = selectedWatchlist.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    return `top-10-picks-${watchlistPart}-${datePart}`;
  };

  const getPlainText = (html: string) => {
    const node = document.createElement('div');
    node.innerHTML = html;
    return (node.textContent || node.innerText || '').replace(/\s+/g, ' ').trim();
  };

  const getReadableText = (content: string) => {
    const node = document.createElement('div');
    node.innerHTML = content;
    return (node.innerText || node.textContent || content)
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  };

  const cleanBulletText = (line: string) => line.replace(/^[-*•]\s*/, '').trim();

  const parseThesis = (content: string) => {
    const text = getReadableText(content);
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const sections: { title: string; bullets: string[] }[] = [];
    let current: { title: string; bullets: string[] } | null = null;

    const isHeading = (line: string) => {
      if (/^[-*•]/.test(line)) return false;
      if (/^decision summary:?$/i.test(line)) return true;
      if (/^agent view:?$/i.test(line)) return true;
      return line.length <= 70 && !/[.!?]$/.test(line);
    };

    lines.forEach((line) => {
      if (isHeading(line)) {
        current = { title: line.replace(/:$/, ''), bullets: [] };
        sections.push(current);
        return;
      }

      if (!current) {
        current = { title: 'Decision Summary', bullets: [] };
        sections.push(current);
      }
      current.bullets.push(cleanBulletText(line));
    });

    const decisionSummary = sections.find((section) => /^decision summary$/i.test(section.title));
    const fallbackSummary = sections.find((section) => section.bullets.length > 0);
    return {
      text,
      sections,
      decisionSummary: decisionSummary || fallbackSummary || { title: 'Decision Summary', bullets: [] },
    };
  };

  const renderDecisionSummary = (pick: WeeklyPick, compact = false) => {
    const { decisionSummary } = parseThesis(pick.thesis);
    const bullets = decisionSummary.bullets.slice(0, compact ? 4 : 6);

    if (bullets.length === 0) {
      return (
        <p className="text-[11px] text-gray-400 leading-relaxed">
          No decision summary was generated for this pick.
        </p>
      );
    }

    return (
      <div className="space-y-2">
        {bullets.map((bullet, index) => (
          <div key={`${pick.symbol}-summary-${index}`} className="grid grid-cols-[14px_1fr] gap-2 text-[11px] leading-relaxed text-gray-300">
            <span className="mt-[7px] h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.35)]" />
            <span>{bullet}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderThesisSections = (pick: WeeklyPick) => {
    const { sections } = parseThesis(pick.thesis);
    const visibleSections = sections.filter((section) => section.bullets.length > 0);

    if (visibleSections.length === 0) {
      return (
        <p className="text-xs text-gray-400">
          No qualitative thesis was generated for this pick.
        </p>
      );
    }

    return (
      <div className="space-y-3">
        {visibleSections.map((section, sectionIndex) => {
          const isSummary = /^decision summary$/i.test(section.title);
          return (
            <section
              key={`${pick.symbol}-${section.title}-${sectionIndex}`}
              className={isSummary ? 'rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] p-3' : 'rounded-lg border border-ramp-grey-800 bg-ramp-grey-950/70 p-3'}
            >
              <h4 className={`mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider ${isSummary ? 'text-cyan-300' : 'text-gray-400'}`}>
                {isSummary && <Sparkles className="h-3 w-3" />}
                {section.title}
              </h4>
              <div className="space-y-1.5">
                {section.bullets.map((bullet, bulletIndex) => (
                  <div key={`${section.title}-${bulletIndex}`} className="grid grid-cols-[14px_1fr] gap-2 text-xs leading-relaxed text-gray-300">
                    <span className={`mt-[7px] h-1.5 w-1.5 rounded-full ${isSummary ? 'bg-cyan-300' : 'bg-gray-500'}`} />
                    <span>{bullet}</span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    );
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const wrapCanvasText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number) => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';

    words.forEach((word) => {
      const nextLine = line ? `${line} ${word}` : word;
      if (ctx.measureText(nextLine).width <= maxWidth) {
        line = nextLine;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    });

    if (line) lines.push(line);
    return lines;
  };

  const handleExportPng = async () => {
    if (!picks.length || exportingFormat) return;

    try {
      setExportingFormat('png');
      const width = 1600;
      const padding = 64;
      const cardGap = 24;
      const cardHeight = 268;
      const headerHeight = 180;
      const footerHeight = 56;
      const height = headerHeight + picks.length * (cardHeight + cardGap) + footerHeight;
      const scale = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is unavailable in this browser');

      ctx.scale(scale, scale);
      ctx.fillStyle = '#0b0f17';
      ctx.fillRect(0, 0, width, height);

      const gradient = ctx.createLinearGradient(0, 0, width, headerHeight);
      gradient.addColorStop(0, '#06b6d4');
      gradient.addColorStop(1, '#4f46e5');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, 10);

      ctx.fillStyle = '#ffffff';
      ctx.font = '700 44px Inter, Arial, sans-serif';
      ctx.fillText('Top 50 Picks', padding, 78);
      ctx.fillStyle = '#9ca3af';
      ctx.font = '500 24px Inter, Arial, sans-serif';
      ctx.fillText(`${selectedWatchlist} • Week of ${selectedDate ? formatDate(selectedDate) : 'Latest analysis'}`, padding, 118);
      ctx.font = '400 18px Inter, Arial, sans-serif';
      ctx.fillText(`Exported ${new Date().toLocaleString('en-IN')}`, padding, 150);

      picks.forEach((pick, index) => {
        const y = headerHeight + index * (cardHeight + cardGap);
        const x = padding;
        const cardWidth = width - padding * 2;
        const isBuy = pick.signal.toLowerCase() === 'buy';
        const { decisionSummary } = parseThesis(pick.thesis);
        const summaryBullets = decisionSummary.bullets.slice(0, 4);

        ctx.fillStyle = '#101722';
        ctx.strokeStyle = pick.rank <= 3 ? '#475569' : '#263244';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(x, y, cardWidth, cardHeight, 18);
        ctx.fill();
        ctx.stroke();

        const cardGradient = ctx.createLinearGradient(x, y, x + cardWidth, y);
        cardGradient.addColorStop(0, 'rgba(6, 182, 212, 0.16)');
        cardGradient.addColorStop(0.55, 'rgba(79, 70, 229, 0.04)');
        cardGradient.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = cardGradient;
        ctx.beginPath();
        ctx.roundRect(x + 2, y + 2, cardWidth - 4, 74, 16);
        ctx.fill();

        ctx.fillStyle = pick.rank <= 3 ? '#f59e0b' : '#06b6d4';
        ctx.beginPath();
        ctx.arc(x + 48, y + 50, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 26px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(pick.rank), x + 48, y + 59);
        ctx.textAlign = 'left';

        ctx.fillStyle = '#ffffff';
        ctx.font = '700 28px Inter, Arial, sans-serif';
        ctx.fillText(pick.symbol.replace('.NS', ''), x + 92, y + 44);
        ctx.fillStyle = '#9ca3af';
        ctx.font = '500 18px Inter, Arial, sans-serif';
        ctx.fillText(pick.name.slice(0, 76), x + 92, y + 74);

        ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
        ctx.strokeStyle = 'rgba(103, 232, 249, 0.34)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x + 92, y + 98, 202, 30, 15);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#67e8f9';
        ctx.font = '700 14px Inter, Arial, sans-serif';
        ctx.fillText('DECISION SUMMARY', x + 108, y + 118);

        ctx.fillStyle = isBuy ? '#10b981' : '#f59e0b';
        ctx.font = '700 18px Inter, Arial, sans-serif';
        ctx.fillText(pick.signal.toUpperCase(), x + cardWidth - 310, y + 44);
        ctx.fillStyle = '#67e8f9';
        ctx.fillText(`${pick.score}% conviction`, x + cardWidth - 310, y + 76);
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(`Risk ${pick.risk_score}/10`, x + cardWidth - 310, y + 108);

        ctx.fillStyle = '#d1d5db';
        ctx.font = '400 19px Inter, Arial, sans-serif';
        const summaryLines = summaryBullets.flatMap((bullet) => wrapCanvasText(ctx, bullet, cardWidth - 160).slice(0, 2)).slice(0, 5);
        summaryLines.forEach((line, lineIndex) => {
          ctx.fillStyle = '#22d3ee';
          ctx.beginPath();
          ctx.arc(x + 102, y + 154 + lineIndex * 25, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#d1d5db';
          ctx.fillText(line, x + 118, y + 160 + lineIndex * 25);
        });
      });

      ctx.fillStyle = '#6b7280';
      ctx.font = '400 16px Inter, Arial, sans-serif';
      ctx.fillText('Generated by AI Hedge Fund weekly picks dashboard', padding, height - 28);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Unable to create PNG export');
      downloadBlob(blob, `${getExportFileBase()}.png`);
    } catch (err: any) {
      setError(err.message || 'Failed to export PNG');
    } finally {
      setExportingFormat(null);
    }
  };

  const escapePdfText = (text: string) => (
    text
      .normalize('NFKD')
      .replace(/[^\x20-\x7E]/g, '')
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
  );

  const wrapPdfText = (text: string, maxChars: number) => {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    words.forEach((word) => {
      const nextLine = line ? `${line} ${word}` : word;
      if (nextLine.length <= maxChars) {
        line = nextLine;
      } else {
        if (line) lines.push(line);
        line = word;
      }
    });
    if (line) lines.push(line);
    return lines;
  };

  const buildPdf = (lines: string[], titleText = 'Top 50 Picks') => {
    const pageWidth = 612;
    const pageHeight = 792;
    const margin = 48;
    const lineHeight = 14;
    const maxLinesPerPage = Math.floor((pageHeight - margin * 2) / lineHeight);
    const pages: string[][] = [];

    for (let i = 0; i < lines.length; i += maxLinesPerPage) {
      pages.push(lines.slice(i, i + maxLinesPerPage));
    }

    const objects: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    ];

    pages.forEach((pageLines, index) => {
      const pageObjectNumber = 3 + index * 2;
      const contentObjectNumber = pageObjectNumber + 1;
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> /F2 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> >> >> /Contents ${contentObjectNumber} 0 R >>`);
      const contentLines = [
        'BT',
        '/F2 20 Tf',
        `${margin} ${pageHeight - margin} Td`,
        index === 0 ? `(${escapePdfText(titleText)}) Tj` : `(${escapePdfText(titleText)} continued) Tj`,
        '/F1 10 Tf',
        `0 -${lineHeight * 1.6} Td`,
        ...pageLines.map((line) => `(${escapePdfText(line)}) Tj 0 -${lineHeight} Td`),
        'ET',
      ];
      const stream = contentLines.join('\n');
      objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    });

    const chunks = ['%PDF-1.4\n'];
    const offsets: number[] = [0];
    objects.forEach((object, index) => {
      offsets.push(chunks.join('').length);
      chunks.push(`${index + 1} 0 obj\n${object}\nendobj\n`);
    });
    const xrefOffset = chunks.join('').length;
    chunks.push(`xref\n0 ${objects.length + 1}\n`);
    chunks.push('0000000000 65535 f \n');
    offsets.slice(1).forEach((offset) => {
      chunks.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    });
    chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
    return new Blob(chunks, { type: 'application/pdf' });
  };

  const handleExportPdf = () => {
    if (!picks.length || exportingFormat) return;

    try {
      setExportingFormat('pdf');
      const lines = [
        `${selectedWatchlist} - Week of ${selectedDate ? formatDate(selectedDate) : 'Latest analysis'}`,
        `Exported ${new Date().toLocaleString('en-IN')}`,
        '',
        ...picks.flatMap((pick) => {
          const { decisionSummary, sections } = parseThesis(pick.thesis);
          const summaryLines = decisionSummary.bullets.length
            ? decisionSummary.bullets.flatMap((bullet) => wrapPdfText(`- ${bullet}`, 95))
            : wrapPdfText(`- ${getPlainText(pick.thesis)}`, 95).slice(0, 4);
          const otherSections = sections
            .filter((section) => !/^decision summary$/i.test(section.title) && section.bullets.length > 0)
            .slice(0, 3)
            .flatMap((section) => [
              `${section.title}:`,
              ...section.bullets.slice(0, 2).flatMap((bullet) => wrapPdfText(`- ${bullet}`, 95)),
            ]);
          return [
            `#${pick.rank} ${pick.symbol.replace('.NS', '')} - ${pick.name}`,
            `Signal: ${pick.signal.toUpperCase()} | Conviction: ${pick.score}% | Risk: ${pick.risk_score}/10`,
            'Decision Summary:',
            ...summaryLines.slice(0, 8),
            ...otherSections,
            '',
          ];
        }),
      ];

      downloadBlob(buildPdf(lines), `${getExportFileBase()}.pdf`);
    } catch (err: any) {
      setError(err.message || 'Failed to export PDF');
    } finally {
      setExportingFormat(null);
    }
  };

  const handleExportSinglePdf = (pick: WeeklyPick) => {
    if (exportingSingleFormat) return;

    try {
      setExportingSingleFormat('pdf');
      const { sections } = parseThesis(pick.thesis);
      const intrinsic = getIntrinsicValue(pick);
      
      const symbolClean = pick.symbol.replace('.NS', '');
      const title = `${symbolClean} Analysis Report`;

      const lines = [
        `Stock: ${symbolClean} - ${pick.name}`,
        `Signal: ${pick.signal.toUpperCase()}`,
        `Conviction Score: ${pick.score}%`,
        `Risk Rating: ${pick.risk_score}/10`,
        `Analysis Date: ${pick.analysis_date || '—'} at ${formatPrice(pick.analysis_price)}`,
        `Current Date: ${pick.current_date || '—'} at ${formatPrice(pick.current_price)}`,
        `Price Move: ${formatPercent(pick.price_change_pct)}`,
        `Intrinsic Value: ${formatIntrinsicPrice(intrinsic?.intrinsic_value_per_share, intrinsic?.currency)}`,
        `Margin of Safety: ${formatMarginOfSafety(intrinsic?.margin_of_safety)}`,
        `Intrinsic Method: ${formatMethodSource(intrinsic?.method, intrinsic?.source)}`,
        `Exported: ${new Date().toLocaleString('en-IN')}`,
        '',
        '--- THESIS BREAKDOWN ---',
        '',
        ...sections.flatMap((section) => {
          return [
            `${section.title.toUpperCase()}:`,
            ...section.bullets.flatMap((bullet) => wrapPdfText(`- ${bullet}`, 95)),
            '',
          ];
        })
      ];

      const filename = `${symbolClean}_Analysis_${pick.analysis_date || 'latest'}.pdf`;
      downloadBlob(buildPdf(lines, title), filename);
    } catch (err: any) {
      setError(err.message || 'Failed to export PDF');
    } finally {
      setExportingSingleFormat(null);
    }
  };

  const handleExportSinglePng = async (pick: WeeklyPick) => {
    if (exportingSingleFormat) return;

    try {
      setExportingSingleFormat('png');
      const symbolClean = pick.symbol.replace('.NS', '');
      const { sections } = parseThesis(pick.thesis);
      const agentSections = getAgentSections(pick);
      const intrinsic = getIntrinsicValue(pick);
      const agentRows = Math.max(1, Math.ceil(agentSections.length / 3));
      const mapHeight = agentSections.length > 0 ? 160 + agentRows * 96 : 88;

      // Create a temporary canvas context for text measurement
      const tempCanvas = document.createElement('canvas');
      const tempCtx = tempCanvas.getContext('2d');
      if (!tempCtx) throw new Error('Canvas not supported');

      // Font configurations matching final canvas
      tempCtx.font = '14px Inter, Arial, sans-serif';
      
      const width = 1200;
      const margin = 50;
      const colW = width - margin * 2; // Full width single column (1100px)

      // Calculate Thesis Breakdown height (Full width single column)
      let leftHeight = 0;
      sections.forEach((section) => {
        if (section.bullets.length === 0) return;
        leftHeight += 35; // Section heading and padding
        section.bullets.forEach((bullet) => {
          const wrapped = wrapCanvasText(tempCtx, bullet, colW - 24);
          leftHeight += wrapped.length * 22 + 8; // Each line height + padding
        });
        leftHeight += 20; // Margin between sections
      });

      // Final canvas specifications
      const contentHeight = Math.max(mapHeight + leftHeight + 48, 430);
      const headerHeight = 170;
      const metricsHeight = 120;
      const footerHeight = 80;
      const height = headerHeight + metricsHeight + contentHeight + footerHeight;

      const scale = window.devicePixelRatio || 2; // High-DPI support
      const canvas = document.createElement('canvas');
      canvas.width = width * scale;
      canvas.height = height * scale;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is unavailable');

      ctx.scale(scale, scale);

      // Background paint
      ctx.fillStyle = '#0b0f17';
      ctx.fillRect(0, 0, width, height);

      // Top gradient bar
      const topGrad = ctx.createLinearGradient(0, 0, width, 0);
      topGrad.addColorStop(0, '#06b6d4');
      topGrad.addColorStop(1, '#4f46e5');
      ctx.fillStyle = topGrad;
      ctx.fillRect(0, 0, width, 10);

      // --- 1. HEADER SECTION ---
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 40px Inter, Arial, sans-serif';
      ctx.fillText(symbolClean, margin, 75);

      const symbolWidth = ctx.measureText(symbolClean).width;

      // Signal Badge
      const isBuy = pick.signal.toLowerCase() === 'buy';
      const badgeX = margin + symbolWidth + 18;
      const badgeY = 42;
      const badgeW = 75;
      const badgeH = 34;
      ctx.fillStyle = isBuy ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)';
      ctx.strokeStyle = isBuy ? 'rgba(16, 185, 129, 0.4)' : 'rgba(245, 158, 11, 0.4)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 6);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isBuy ? '#10b981' : '#f59e0b';
      ctx.font = '700 14px Inter, Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pick.signal.toUpperCase(), badgeX + badgeW / 2, badgeY + 22);
      ctx.textAlign = 'left';

      // Company Name & Subtext
      ctx.fillStyle = '#9ca3af';
      ctx.font = '500 18px Inter, Arial, sans-serif';
      ctx.fillText(pick.name, margin, 110);

      ctx.fillStyle = '#6b7280';
      ctx.font = '400 13px Inter, Arial, sans-serif';
      ctx.fillText(`Analysis Run Date: ${pick.analysis_date || '—'}  |  Exported: ${new Date().toLocaleString('en-IN')}`, margin, 134);

      // Right Header Badges (Conviction & Risk)
      // Conviction Badge
      const convictionText = `${pick.score}% Conviction`;
      ctx.font = '600 13px Inter, Arial, sans-serif';
      const convW = ctx.measureText(convictionText).width + 24;
      const convX = width - margin - convW;
      const rightBadgeY = 48;
      
      ctx.fillStyle = 'rgba(6, 182, 212, 0.12)';
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
      ctx.beginPath();
      ctx.roundRect(convX, rightBadgeY, convW, 28, 14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#22d3ee';
      ctx.fillText(convictionText, convX + 12, rightBadgeY + 18);

      // Risk Badge
      const riskText = `Risk: ${pick.risk_score}/10`;
      const riskW = ctx.measureText(riskText).width + 24;
      const riskX = convX - 15 - riskW;
      
      ctx.fillStyle = 'rgba(239, 68, 68, 0.12)';
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.35)';
      ctx.beginPath();
      ctx.roundRect(riskX, rightBadgeY, riskW, 28, 14);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#f87171';
      ctx.fillText(riskText, riskX + 12, rightBadgeY + 18);

      // --- 2. METRICS CARDS SECTION ---
      const cardStartY = 160;
      const gap = 20;
      const cardW = (width - margin * 2 - gap * 4) / 5;
      const cardH = 86;

      const metrics = [
        { label: 'ANALYSIS PRICE', val: formatPrice(pick.analysis_price), sub: pick.analysis_date || '—' },
        { label: 'CAPTURED CURRENT', val: formatPrice(pick.current_price_at_analysis), sub: 'At analysis time' },
        { label: 'CURRENT PRICE', val: formatPrice(pick.current_price), sub: pick.current_date || 'Latest cached' },
        { 
          label: 'MOVE SINCE ANALYSIS', 
          val: formatPercent(pick.price_change_pct), 
          sub: 'Analysis vs current', 
          color: (pick.price_change_pct || 0) >= 0 ? '#10b981' : '#ef4444' 
        },
        {
          label: 'INTRINSIC VALUE',
          val: formatMarginOfSafety(intrinsic?.margin_of_safety),
          sub: formatIntrinsicPrice(intrinsic?.intrinsic_value_per_share, intrinsic?.currency),
          color: (intrinsic?.margin_of_safety || 0) >= 0 ? '#10b981' : '#ef4444'
        },
      ];

      metrics.forEach((m, idx) => {
        const x = margin + idx * (cardW + gap);
        ctx.fillStyle = '#101722';
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x, cardStartY, cardW, cardH, 10);
        ctx.fill();
        ctx.stroke();

        // Label
        ctx.fillStyle = '#9ca3af';
        ctx.font = '700 10px Inter, Arial, sans-serif';
        ctx.fillText(m.label, x + 16, cardStartY + 24);

        // Value
        ctx.fillStyle = m.color || '#ffffff';
        ctx.font = '700 20px Inter, Arial, sans-serif';
        ctx.fillText(m.val, x + 16, cardStartY + 52);

        // Subtext
        ctx.fillStyle = '#4b5563';
        ctx.font = '500 11px Inter, Arial, sans-serif';
        ctx.fillText(m.sub, x + 16, cardStartY + 72);
      });

      // --- 3. SINGLE COLUMN CONTENT SECTION ---
      const contentStartY = cardStartY + cardH + 35;
      const drawArrow = (fromX: number, fromY: number, toX: number, toY: number) => {
        const angle = Math.atan2(toY - fromY, toX - fromX);
        const headLength = 9;

        ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.lineTo(toX, toY);
        ctx.stroke();

        ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(
          toX - headLength * Math.cos(angle - Math.PI / 6),
          toY - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          toX - headLength * Math.cos(angle + Math.PI / 6),
          toY - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fill();
      };

      const drawMapNode = (
        x: number,
        y: number,
        nodeW: number,
        nodeH: number,
        title: string,
        subtitle: string,
        tone: AgentSignalTone
      ) => {
        const colors = getCanvasToneColors(tone);
        ctx.fillStyle = colors.fill;
        ctx.strokeStyle = colors.stroke;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.roundRect(x, y, nodeW, nodeH, 12);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = colors.text;
        ctx.font = '700 12px Inter, Arial, sans-serif';
        const titleLines = wrapCanvasText(ctx, title, nodeW - 24).slice(0, 2);
        titleLines.forEach((line, index) => {
          ctx.fillText(line, x + 12, y + 22 + index * 15);
        });

        ctx.fillStyle = colors.subtext;
        ctx.font = '600 10px Inter, Arial, sans-serif';
        ctx.fillText(subtitle.slice(0, 36), x + 12, y + nodeH - 14);
      };

      // --- Agent Thesis Map ---
      let currentY = contentStartY;
      ctx.fillStyle = '#22d3ee';
      ctx.font = '700 15px Inter, Arial, sans-serif';
      ctx.fillText('AGENT THESIS MAP', margin, currentY);
      currentY += 22;

      const mapY = currentY;
      ctx.fillStyle = '#101722';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(margin, mapY, colW, mapHeight - 18, 14);
      ctx.fill();
      ctx.stroke();

      if (agentSections.length > 0) {
        const stockW = 160;
        const summaryW = 178;
        const nodeH = 64;
        const agentW = 210;
        const agentGapX = 18;
        const agentGapY = 32;
        const stockX = margin + 24;
        const stockY = mapY + 40 + Math.max(0, agentRows - 1) * 48;
        const portfolioX = width - margin - summaryW - 24;
        const portfolioY = stockY;
        const riskY = portfolioY + 88;
        const agentAreaX = stockX + stockW + 56;
        const agentAreaW = portfolioX - agentAreaX - 56;
        const columns = Math.min(3, agentSections.length);
        const colWidth = columns > 1 ? (agentAreaW - agentGapX * (columns - 1)) / columns : agentAreaW;
        const actualAgentW = Math.min(agentW, colWidth);

        drawMapNode(stockX, stockY, stockW, nodeH, 'Screened Stock', symbolClean, 'summary');
        drawMapNode(
          portfolioX,
          portfolioY,
          summaryW,
          nodeH,
          'Portfolio Decision',
          `${pick.signal.toUpperCase()} - ${pick.score}%`,
          getSignalTone(pick.signal)
        );
        drawMapNode(portfolioX, riskY, summaryW, nodeH, 'Risk Review', `${pick.risk_score}/10`, 'risk');
        drawArrow(portfolioX + summaryW / 2, portfolioY + nodeH, portfolioX + summaryW / 2, riskY);

        agentSections.forEach((section, index) => {
          const col = index % columns;
          const row = Math.floor(index / columns);
          const x = agentAreaX + col * (actualAgentW + agentGapX);
          const y = mapY + 36 + row * (nodeH + agentGapY);
          const tone = getSignalTone(section.signal, section.agent);
          const confidence = formatAgentConfidence(section.confidence);

          drawMapNode(
            x,
            y,
            actualAgentW,
            nodeH,
            section.agent || `Agent ${index + 1}`,
            `${section.signal || 'n/a'} - ${confidence}`,
            tone
          );
          drawArrow(stockX + stockW, stockY + nodeH / 2, x, y + nodeH / 2);
          drawArrow(x + actualAgentW, y + nodeH / 2, portfolioX, portfolioY + nodeH / 2);
        });

        const legendY = mapY + mapHeight - 42;
        let legendX = margin + 24;
        AGENT_SIGNAL_LEGEND.forEach((item) => {
          const colors = getCanvasToneColors(item.tone);
          ctx.fillStyle = colors.stroke;
          ctx.beginPath();
          ctx.arc(legendX + 5, legendY - 4, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#94a3b8';
          ctx.font = '600 10px Inter, Arial, sans-serif';
          ctx.fillText(item.label.toUpperCase(), legendX + 15, legendY);
          legendX += ctx.measureText(item.label.toUpperCase()).width + 42;
        });
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '500 13px Inter, Arial, sans-serif';
        ctx.fillText('No structured agent outputs were stored for this pick.', margin + 24, mapY + 44);
      }

      currentY = contentStartY + mapHeight + 20;

      // --- Thesis Breakdown ---
      ctx.fillStyle = '#22d3ee';
      ctx.font = '700 15px Inter, Arial, sans-serif';
      ctx.fillText('THESIS BREAKDOWN', margin, currentY);
      currentY += 24;

      sections.forEach((section) => {
        if (section.bullets.length === 0) return;
        
        ctx.fillStyle = /^decision summary$/i.test(section.title) ? '#67e8f9' : '#e2e8f0';
        ctx.font = '700 12px Inter, Arial, sans-serif';
        ctx.fillText(section.title.toUpperCase(), margin, currentY);
        currentY += 16;

        section.bullets.forEach((bullet) => {
          ctx.font = '400 13px Inter, Arial, sans-serif';
          const wrapped = wrapCanvasText(ctx, bullet, colW - 24);
          
          wrapped.forEach((line, lIdx) => {
            if (lIdx === 0) {
              // Draw bullet indicator
              ctx.fillStyle = /^decision summary$/i.test(section.title) ? '#22d3ee' : '#6b7280';
              ctx.beginPath();
              ctx.arc(margin + 6, currentY - 4, 3, 0, Math.PI * 2);
              ctx.fill();
            }
            ctx.fillStyle = '#cbd5e1';
            ctx.fillText(line, margin + 20, currentY);
            currentY += 22;
          });
          currentY += 6; // bullet gap
        });
        currentY += 14; // section gap
      });

      // --- 4. FOOTER ---
      const footerY = height - 40;
      // Divider line
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin, footerY - 15);
      ctx.lineTo(width - margin, footerY - 15);
      ctx.stroke();

      ctx.fillStyle = '#6b7280';
      ctx.font = '400 12px Inter, Arial, sans-serif';
      ctx.fillText('Generated by AI Hedge Fund Weekly Picks Dashboard', margin, footerY + 8);
      
      const watermark = 'Confidential Report • Proprietary Systems';
      ctx.font = '600 11px Inter, Arial, sans-serif';
      ctx.fillStyle = 'rgba(6, 182, 212, 0.4)';
      const waterW = ctx.measureText(watermark).width;
      ctx.fillText(watermark, width - margin - waterW, footerY + 8);

      // Export as file
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Unable to create PNG export');
      const filename = `${symbolClean}_Analysis_${pick.analysis_date || 'latest'}.png`;
      downloadBlob(blob, filename);
    } catch (err: any) {
      setError(err.message || 'Failed to export PNG');
    } finally {
      setExportingSingleFormat(null);
    }
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
                Run the multi-agent hedge fund analyzer across {selectedWatchlist === 'Nifty 500' ? 'Nifty 500 candidate stocks' : `candidate stocks in "${selectedWatchlist}"`}. Technical filters screen down candidates, then qualitative AI agents decide the top 50 buys.
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
                  models={models}
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
              <div className="flex items-center justify-between gap-3 p-3 bg-indigo-950/30 border border-indigo-900/30 rounded-lg text-indigo-300 text-xs">
                <div className="flex items-center gap-3">
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-400 flex-shrink-0" />
                  <div className="flex-1">
                    <span className="font-semibold">Pipeline Execution Status: </span>
                    <span className="capitalize font-mono">{runningJob.status}...</span>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Triggered at {new Date(runningJob.created_at).toLocaleTimeString()} ({runningJob.test_mode ? 'Speed Test' : 'Full Ingestion'}) on universe <span className="font-semibold text-cyan-400">{runningJob.watchlist_name || 'Nifty 500'}</span>. This might take 1–2 minutes.
                    </p>
                  </div>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  className="bg-red-950 hover:bg-red-900 text-red-400 border border-red-900/50 text-[10px] h-8 shrink-0 flex items-center gap-1.5 active:scale-[0.98] transition-all"
                  onClick={() => handleCancelPipeline(runningJob.id)}
                  disabled={isCancelling}
                >
                  {isCancelling ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                  {isCancelling ? 'Stopping...' : 'Stop Pipeline'}
                </Button>
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
                                      run.status === 'CANCELLED' ? 'text-gray-400 bg-gray-500/10' :
                                      'text-cyan-400 bg-cyan-500/10 animate-pulse';
                    const canOpenRun = run.status === 'COMPLETED';
                    const rowClassName = `w-full text-left bg-ramp-grey-950 border border-ramp-grey-850 rounded-lg p-2 text-[10px] space-y-1 ${
                      canOpenRun ? 'hover:border-cyan-500/50 hover:bg-ramp-grey-900 cursor-pointer transition-colors' : ''
                    }`;
                    const RowTag = canOpenRun ? 'button' : 'div';
                    return (
                      <RowTag
                        key={run.id}
                        type={canOpenRun ? 'button' : undefined}
                        onClick={canOpenRun ? () => openHistoricalRun(run) : undefined}
                        className={rowClassName}
                        title={canOpenRun ? `Open ${run.watchlist_name || 'Nifty 500'} analysis from ${formatDate(run.run_date)}` : undefined}
                      >
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
                        {(run.status === 'FAILED' || run.status === 'CANCELLED') && run.error_message && (
                          <p className="text-rose-400 font-mono text-[8px] bg-red-950/20 p-1 rounded border border-red-900/20 max-w-full break-words mt-1 leading-normal">
                            Error: {run.error_message}
                          </p>
                        )}
                      </RowTag>
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
        
        {/* Left Side: Top 50 Picks List */}
        <div className="flex-grow flex-1 w-full space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <h2 className="min-w-0 text-white flex items-start gap-2">
              <Shield className="h-5 w-5 text-cyan-400 mt-0.5 flex-shrink-0" />
              <span className="min-w-0 flex flex-col">
                <span className="text-xl font-bold tracking-tight leading-tight">Top 50 Picks</span>
                <span className="text-xs font-medium text-gray-400 leading-snug">
                  {selectedWatchlist} • Week of {selectedDate ? formatDate(selectedDate) : '...'}
                </span>
              </span>
            </h2>
            <div className="flex items-center gap-2">
              {loadingPicks && <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />}
              <Button
                variant="outline"
                size="sm"
                className="bg-ramp-grey-950 border-ramp-grey-800 hover:bg-ramp-grey-800 text-cyan-300"
                disabled={loadingPicks || picks.length === 0 || exportingFormat !== null}
                onClick={handleExportPng}
                title="Export Top 50 Picks as PNG"
              >
                {exportingFormat === 'png' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileImage className="h-4 w-4 mr-2" />}
                PNG
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-ramp-grey-950 border-ramp-grey-800 hover:bg-ramp-grey-800 text-indigo-300"
                disabled={loadingPicks || picks.length === 0 || exportingFormat !== null}
                onClick={handleExportPdf}
                title="Export Top 50 Picks as PDF"
              >
                {exportingFormat === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileText className="h-4 w-4 mr-2" />}
                PDF
              </Button>
            </div>
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
                const analysisError = getAnalysisError(pick);
                const hasAnalysisError = Boolean(analysisError);
                const rankColor = hasAnalysisError ? 'from-rose-500 to-red-700' :
                                  pick.rank === 1 ? 'from-amber-400 to-yellow-500' :
                                  pick.rank === 2 ? 'from-slate-300 to-slate-400' :
                                  pick.rank === 3 ? 'from-amber-600 to-amber-700' : 
                                  'from-cyan-500 to-indigo-500';
                                  
                return (
                  <Card key={pick.symbol} className={`group bg-ramp-grey-900/95 text-white shadow-xl transition-all duration-300 overflow-hidden flex flex-col ${hasAnalysisError ? 'border-rose-500/50 hover:border-rose-400/70 hover:shadow-rose-950/20' : 'border-ramp-grey-800 hover:border-cyan-500/30 hover:shadow-cyan-950/20'}`}>
                    {/* Glowing header showing rank & symbol */}
                    <div className="p-4 border-b border-ramp-grey-800 bg-gradient-to-r from-ramp-grey-950 via-ramp-grey-950 to-ramp-grey-900 flex items-start justify-between gap-3 flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div className={`h-9 w-9 rounded-full bg-gradient-to-r ${rankColor} flex items-center justify-center font-bold text-white text-sm shadow-md ring-2 ring-white/5`}>
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
                      <div className="flex flex-wrap justify-end items-center gap-2">
                        {hasAnalysisError ? (
                          <Badge variant="destructive" className="text-xs py-0.5 px-2.5 gap-1.5 bg-rose-500/90 text-white">
                            <AlertCircle className="h-3.5 w-3.5" />
                            ANALYSIS ERROR
                          </Badge>
                        ) : (
                          <>
                            <Badge variant={isBuy ? 'success' : 'warning'} className="text-xs py-0.5 px-2.5">
                              {pick.signal.toUpperCase()}
                            </Badge>
                            <Badge variant="outline" className="text-xs border-cyan-500/20 text-cyan-400 font-semibold">
                              {pick.score}% Conv
                            </Badge>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {/* Thesis & metrics */}
                    {hasAnalysisError ? (
                      <CardContent className="p-4 flex-1 flex flex-col justify-center">
                        <div role="alert" className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
                          <div className="flex items-start gap-3">
                            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
                            <div className="space-y-2">
                              <p className="font-semibold text-rose-200">Analysis could not be completed</p>
                              <p className="leading-relaxed text-rose-100/90">{analysisError?.message}</p>
                              <p className="text-xs text-rose-200/75">
                                No trading recommendation was generated. Re-run the pipeline to retry this stock.
                              </p>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    ) : (
                    <CardContent className="p-4 flex-1 flex flex-col justify-between gap-4">
                      {/* Horizontal stats grid */}
                      {(() => {
                        const stockDetail = stocks.find(s => s.symbol === pick.symbol);
                        const isGain = (pick.price_change_pct || 0) >= 0;
                        const riskLabel = pick.risk_score <= 3 ? 'Low' : pick.risk_score <= 6 ? 'Med' : 'High';
                        const riskColor = pick.risk_score <= 3 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                                           pick.risk_score <= 6 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                                           'text-rose-400 bg-rose-500/10 border-rose-500/20';
                        const intrinsic = getIntrinsicValue(pick);
                        const mosClass = getMarginToneClass(intrinsic?.margin_of_safety);

                        return (
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 w-full">
                            {/* Panel 1: Price Action */}
                            <div className="bg-ramp-grey-950/60 hover:bg-ramp-grey-950/80 border border-ramp-grey-800/40 p-3 rounded-lg flex flex-col justify-between shadow-inner hover:border-cyan-500/20 transition-all duration-300">
                              <div className="flex flex-col gap-1.5">
                                <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">Price Performance</span>
                                <div className="space-y-1">
                                  <div className="flex justify-between text-xs">
                                    <span className="text-gray-500">Analysis</span>
                                    <span className="font-bold text-gray-200">{formatPrice(pick.analysis_price)}</span>
                                  </div>
                                  <div className="flex justify-between text-xs">
                                    <span className="text-gray-500">Current</span>
                                    <span className="font-bold text-gray-200">{formatPrice(pick.current_price)}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="mt-2 pt-1.5 border-t border-ramp-grey-800/40 flex items-center justify-between">
                                <span className="text-[9px] text-gray-500">Return</span>
                                <span className={`text-[11px] font-bold flex items-center gap-0.5 ${isGain ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {isGain ? '▲' : '▼'} {formatPercent(pick.price_change_pct)}
                                </span>
                              </div>
                            </div>

                            {/* Panel 2: Conviction & Risk */}
                            <div className="bg-ramp-grey-950/60 hover:bg-ramp-grey-950/80 border border-ramp-grey-800/40 p-3 rounded-lg flex flex-col justify-between shadow-inner hover:border-cyan-500/20 transition-all duration-300">
                              <div className="flex flex-col gap-1.5">
                                <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">Conviction & Risk</span>
                                <div className="space-y-1.5">
                                  <div>
                                    <div className="flex justify-between text-xs mb-1">
                                      <span className="text-gray-500">Conviction</span>
                                      <span className="font-bold text-gray-200">{pick.score}%</span>
                                    </div>
                                    <div className="w-full bg-gray-800/50 rounded-full h-1 overflow-hidden">
                                      <div 
                                        className="bg-gradient-to-r from-cyan-400 to-indigo-500 h-1 rounded-full" 
                                        style={{ width: `${pick.score}%` }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="mt-2 pt-1.5 border-t border-ramp-grey-800/40 flex items-center justify-between">
                                <span className="text-[9px] text-gray-500">Risk Rating</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${riskColor}`}>
                                  {pick.risk_score}/10 ({riskLabel})
                                </span>
                              </div>
                            </div>

                            {/* Panel 3: Financial Ratios */}
                            <div className="bg-ramp-grey-950/60 hover:bg-ramp-grey-950/80 border border-ramp-grey-800/40 p-3 rounded-lg flex flex-col justify-between shadow-inner hover:border-cyan-500/20 transition-all duration-300">
                              <div className="flex flex-col gap-1.5">
                                <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">Key Ratios</span>
                                {stockDetail ? (
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-xs">
                                      <span className="text-gray-500">P/E Ratio</span>
                                      <span className="font-bold text-gray-200">
                                        {stockDetail.fundamentals?.pe_ratio ? stockDetail.fundamentals.pe_ratio.toFixed(1) : '—'}
                                      </span>
                                    </div>
                                    <div className="flex justify-between text-xs">
                                      <span className="text-gray-500">ROE</span>
                                      <span className="font-bold text-gray-200">
                                        {stockDetail.fundamentals?.roe ? `${stockDetail.fundamentals.roe.toFixed(1)}%` : '—'}
                                      </span>
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-gray-500 italic">No ratios cached</span>
                                )}
                              </div>
                              <div className="mt-2 pt-1.5 border-t border-ramp-grey-800/40 flex items-center justify-between">
                                <span className="text-[9px] text-gray-500">1Y Return</span>
                                <span className={`text-[11px] font-bold ${stockDetail && stockDetail.performance_1y && stockDetail.performance_1y >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                  {stockDetail ? formatPercent(stockDetail.performance_1y) : '—'}
                                </span>
                              </div>
                            </div>

                            {/* Panel 4: Intrinsic Value */}
                            <div className="bg-ramp-grey-950/60 hover:bg-ramp-grey-950/80 border border-ramp-grey-800/40 p-3 rounded-lg flex flex-col justify-between shadow-inner hover:border-cyan-500/20 transition-all duration-300">
                              <div className="flex flex-col gap-1.5 min-w-0">
                                <span className="text-[9px] text-gray-400 uppercase tracking-wider font-semibold">Intrinsic Value</span>
                                <div className="space-y-1 min-w-0">
                                  <div className="flex justify-between text-xs min-w-0 gap-2">
                                    <span className="text-gray-500 shrink-0">Fair Value</span>
                                    <span className="font-bold text-gray-200 truncate">
                                      {formatIntrinsicPrice(intrinsic?.intrinsic_value_per_share, intrinsic?.currency)}
                                    </span>
                                  </div>
                                  <div className="flex justify-between text-xs min-w-0 gap-2">
                                    <span className="text-gray-500 shrink-0">Method</span>
                                    <span className="font-bold text-gray-200 truncate" title={formatMethodSource(intrinsic?.method, intrinsic?.source)}>
                                      {intrinsic?.method ? intrinsic.method.replace(/_/g, ' ') : '—'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="mt-2 pt-1.5 border-t border-ramp-grey-800/40 flex items-center justify-between">
                                <span className="text-[9px] text-gray-500">Margin</span>
                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${mosClass}`}>
                                  {formatMarginOfSafety(intrinsic?.margin_of_safety)}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Decision Summary - 100% Width */}
                      <div className="w-full flex flex-col gap-3">
                        <div className="rounded-lg bg-gradient-to-br from-cyan-500/[0.04] via-ramp-grey-950/80 to-ramp-grey-950/90 p-4 border border-cyan-500/10 shadow-lg">
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <span className="inline-flex items-center gap-1.5 text-[10px] text-cyan-300 uppercase tracking-wider font-bold">
                              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                              Decision Summary
                            </span>
                            <span className="text-[9px] text-gray-500">
                              Based on technical & qualitative indicators
                            </span>
                          </div>
                          <div className="min-h-[120px] max-h-[180px] overflow-y-auto pr-1 scrollbar-thin scrollbar-thumb-ramp-grey-800">
                            {renderDecisionSummary(pick, false)}
                          </div>
                        </div>

                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full h-9 justify-center bg-ramp-grey-950 border-ramp-grey-800 hover:border-cyan-500/40 hover:bg-ramp-grey-800 hover:text-cyan-300 text-cyan-400/90 text-xs transition-all duration-200"
                          onClick={() => setSelectedAnalysis(pick)}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-2" />
                          Open complete analysis
                        </Button>
                      </div>
                    </CardContent>
                    )}
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
            <form onSubmit={handleAddManualTicker} className="flex items-center gap-2">
              <input
                type="text"
                value={manualTicker}
                onChange={(e) => {
                  setManualTicker(e.target.value);
                  setManualTickerError(null);
                }}
                placeholder="TICKER"
                className="min-w-0 flex-1 bg-ramp-grey-1000 border border-ramp-grey-850 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder:text-gray-600 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={!manualTicker.trim()}
                className="bg-ramp-grey-850 hover:bg-ramp-grey-800 disabled:opacity-50 disabled:hover:bg-ramp-grey-850 border border-ramp-grey-800 text-gray-300 p-1.5 rounded-lg text-xs hover:text-white transition-all flex items-center justify-center"
                title="Add ticker"
              >
                <Plus size={14} />
              </button>
            </form>
            {manualTickerError && (
              <div className="text-[10px] text-rose-400 -mt-1">{manualTickerError}</div>
            )}

            <div className="flex-1 min-h-[150px] max-h-[300px] overflow-y-auto bg-ramp-grey-1000 border border-ramp-grey-850 rounded-xl p-3 scrollbar-thin scrollbar-thumb-ramp-grey-800 flex flex-col">
              {!activeWatchlist || activeWatchlist.tickers.length === 0 ? (
                <div className="flex-grow flex items-center justify-center text-center text-[10px] text-gray-500 p-4">
                  Add a ticker or select stocks from Weekly Picks or Screener.
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
                    models={models}
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

      <Dialog open={!!selectedAnalysis} onOpenChange={(open) => !open && setSelectedAnalysis(null)}>
        <DialogContent className="max-w-5xl max-h-[86vh] overflow-y-auto bg-ramp-grey-900 border-ramp-grey-800 text-white">
          {selectedAnalysis && (
            <>
              <DialogHeader className="flex flex-row items-center justify-between gap-4">
                <div className="flex-1">
                  <DialogTitle className="flex flex-wrap items-center gap-2 text-white">
                    <span>{selectedAnalysis.symbol.replace('.NS', '')}</span>
                    <Badge variant={selectedAnalysis.signal.toLowerCase() === 'buy' ? 'success' : 'warning'}>
                      {selectedAnalysis.signal.toUpperCase()}
                    </Badge>
                  </DialogTitle>
                  <DialogDescription className="text-gray-400 mt-1.5">
                    Analysis date {selectedAnalysis.analysis_date || '—'} at {formatPrice(selectedAnalysis.analysis_price)} · Current {selectedAnalysis.current_date || '—'} at {formatPrice(selectedAnalysis.current_price)}
                  </DialogDescription>
                </div>
                <div className="flex items-center gap-2 mr-8 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-ramp-grey-950 border-ramp-grey-800 hover:bg-ramp-grey-800 text-cyan-300 text-xs"
                    disabled={exportingSingleFormat !== null}
                    onClick={() => handleExportSinglePng(selectedAnalysis)}
                    title="Export Analysis to PNG"
                  >
                    {exportingSingleFormat === 'png' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileImage className="h-3.5 w-3.5 mr-1.5" />}
                    PNG
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-ramp-grey-950 border-ramp-grey-800 hover:bg-ramp-grey-800 text-indigo-300 text-xs"
                    disabled={exportingSingleFormat !== null}
                    onClick={() => handleExportSinglePdf(selectedAnalysis)}
                    title="Export Analysis to PDF"
                  >
                    {exportingSingleFormat === 'pdf' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
                    PDF
                  </Button>
                </div>
              </DialogHeader>

              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold">Analysis Price</span>
                  <p className="text-sm font-bold text-gray-100 mt-1">{formatPrice(selectedAnalysis.analysis_price)}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{selectedAnalysis.analysis_date || '—'}</p>
                </div>
                <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold">Captured Current</span>
                  <p className="text-sm font-bold text-gray-100 mt-1">{formatPrice(selectedAnalysis.current_price_at_analysis)}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">At analysis time</p>
                </div>
                <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold">Current Price</span>
                  <p className="text-sm font-bold text-gray-100 mt-1">{formatPrice(selectedAnalysis.current_price)}</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">{selectedAnalysis.current_date || 'Latest cached'}</p>
                </div>
                <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold">Move Since Analysis</span>
                  <p className={`text-sm font-bold mt-1 ${(selectedAnalysis.price_change_pct || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {formatPercent(selectedAnalysis.price_change_pct)}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Analysis price vs current</p>
                </div>
                <div className="bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3">
                  <span className="text-[10px] text-gray-500 uppercase font-semibold">Intrinsic Value</span>
                  <p className="text-sm font-bold text-gray-100 mt-1">
                    {formatIntrinsicPrice(getIntrinsicValue(selectedAnalysis)?.intrinsic_value_per_share, getIntrinsicValue(selectedAnalysis)?.currency)}
                  </p>
                  <p className={`inline-flex mt-1 rounded border px-1.5 py-0.5 text-[10px] font-bold ${getMarginToneClass(getIntrinsicValue(selectedAnalysis)?.margin_of_safety)}`}>
                    {formatMarginOfSafety(getIntrinsicValue(selectedAnalysis)?.margin_of_safety)}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-1 truncate" title={formatMethodSource(getIntrinsicValue(selectedAnalysis)?.method, getIntrinsicValue(selectedAnalysis)?.source)}>
                    {formatMethodSource(getIntrinsicValue(selectedAnalysis)?.method, getIntrinsicValue(selectedAnalysis)?.source)}
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-ramp-grey-800 bg-ramp-grey-950/70 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs uppercase tracking-wider text-cyan-300 font-semibold">Historical Price vs Current</h3>
                  <span className="text-[10px] text-gray-500">
                    Current reference: {formatPrice(selectedAnalysis.current_price ?? analysisPrices[analysisPrices.length - 1]?.close)}
                  </span>
                </div>
                {analysisPricesLoading && (
                  <div className="flex items-center gap-2 py-3 text-xs text-gray-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-400" />
                    Loading historical prices...
                  </div>
                )}
                {!analysisPricesLoading && historicalPriceComparisons.length === 0 && (
                  <p className="py-3 text-xs text-gray-500">Historical price checkpoints are not available for this stock.</p>
                )}
                {!analysisPricesLoading && historicalPriceComparisons.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
                    {historicalPriceComparisons.map((item) => {
                      const isGain = (item.percentFromThen ?? 0) >= 0;
                      return (
                        <div key={item.label} className="rounded-md border border-ramp-grey-800 bg-ramp-grey-1000 px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{item.label}</p>
                              <p className="mt-1 text-sm font-bold text-gray-100">{formatPrice(item.price)}</p>
                            </div>
                            <div className="text-right">
                              <p className={`text-sm font-bold ${isGain ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {formatPercent(item.percentFromThen)}
                              </p>
                              <p className="text-[9px] uppercase tracking-wider text-gray-600">to current</p>
                            </div>
                          </div>
                          <p className="mt-1 text-[10px] text-gray-500">
                            {item.actualDate ? `${item.actualDate}${item.actualDate !== item.targetDate ? ` near ${item.targetDate}` : ''}` : `No price near ${item.targetDate}`}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
                <div className="min-h-0">
                  <h3 className="text-xs uppercase tracking-wider text-cyan-300 font-semibold mb-2 flex items-center gap-2">
                    <Sparkles className="h-3.5 w-3.5" />
                    Agent Thesis Map
                  </h3>
                  <div className="max-h-[46vh] overflow-y-auto space-y-4 rounded-lg border border-ramp-grey-800 bg-ramp-grey-950/70 p-3 text-xs text-gray-300 leading-relaxed scrollbar-thin scrollbar-thumb-ramp-grey-800">
                    <AgentThesisMermaidDiagram pick={selectedAnalysis} />
                    <div>
                      <h4 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                        Thesis Breakdown
                      </h4>
                      {renderThesisSections(selectedAnalysis)}
                    </div>
                  </div>
                </div>
                <div className="min-h-0">
                  <h3 className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">Complete Stored Analysis</h3>
                  <pre className="max-h-[46vh] overflow-auto bg-ramp-grey-950 border border-ramp-grey-800 rounded-lg p-3 text-[11px] text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {JSON.stringify(selectedAnalysis.analysis_details || {}, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

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
