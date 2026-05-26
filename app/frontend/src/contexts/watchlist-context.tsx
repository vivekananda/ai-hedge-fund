import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { api, Watchlist } from '@/services/api';
import { ModelItem, defaultModel } from '@/data/models';

type TabType = 'simulation' | 'screener' | 'weekly-picks';

interface WatchlistContextType {
  watchlists: Watchlist[];
  activeWatchlistName: string | null;
  activeWatchlist: Watchlist | null;
  activeTab: TabType;
  simulationTickers: string;
  selectedModel: ModelItem | null;
  pendingAutoRun: boolean;
  
  setActiveTab: (tab: TabType) => void;
  setSimulationTickers: (tickers: string) => void;
  setSelectedModel: (model: ModelItem | null) => void;
  setPendingAutoRun: (pending: boolean) => void;
  setActiveWatchlistName: (name: string | null) => void;
  
  refreshWatchlists: () => Promise<void>;
  createWatchlist: (name: string) => Promise<Watchlist>;
  deleteWatchlist: (name: string) => Promise<void>;
  addTickerToActive: (ticker: string) => Promise<void>;
  removeTickerFromActive: (ticker: string) => Promise<void>;
  isInActiveWatchlist: (ticker: string) => boolean;
  runSimulationOnActive: (model: ModelItem | null) => void;
  runSimulationOnTicker: (ticker: string, model: ModelItem | null) => void;
}

const WatchlistContext = createContext<WatchlistContextType | undefined>(undefined);

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [activeWatchlistName, setActiveWatchlistNameState] = useState<string | null>(() => {
    return localStorage.getItem('ai_hedge_fund_active_watchlist');
  });
  
  const [activeTab, setActiveTab] = useState<TabType>('simulation');
  const [simulationTickers, setSimulationTickers] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<ModelItem | null>(defaultModel);
  const [pendingAutoRun, setPendingAutoRun] = useState<boolean>(false);

  // Fetch watchlists from backend
  const refreshWatchlists = useCallback(async () => {
    try {
      const data = await api.getWatchlists();
      setWatchlists(data);
      
      // If there's no active watchlist selected but database has lists, auto-select the first one
      if (data.length > 0) {
        if (!activeWatchlistName || !data.some(w => w.name === activeWatchlistName)) {
          setActiveWatchlistName(data[0].name);
        }
      } else {
        setActiveWatchlistName(null);
      }
    } catch (err) {
      console.error('Failed to fetch watchlists from backend:', err);
    }
  }, [activeWatchlistName]);

  // Load watchlists on mount
  useEffect(() => {
    refreshWatchlists();
  }, []);

  // Setter wrapper that also saves to local storage
  const setActiveWatchlistName = useCallback((name: string | null) => {
    setActiveWatchlistNameState(name);
    if (name) {
      localStorage.setItem('ai_hedge_fund_active_watchlist', name);
    } else {
      localStorage.removeItem('ai_hedge_fund_active_watchlist');
    }
  }, []);

  // Helper to get active watchlist object
  const activeWatchlist = watchlists.find(w => w.name === activeWatchlistName) || null;

  // Create new watchlist
  const createWatchlist = async (name: string): Promise<Watchlist> => {
    const cleanName = name.trim();
    if (!cleanName) throw new Error('Watchlist name cannot be empty');
    
    // Check if name already exists
    if (watchlists.some(w => w.name.toLowerCase() === cleanName.toLowerCase())) {
      throw new Error(`A watchlist named "${cleanName}" already exists`);
    }

    const newWatchlist = await api.saveWatchlist(cleanName, []);
    setWatchlists(prev => [...prev, newWatchlist].sort((a, b) => a.name.localeCompare(b.name)));
    setActiveWatchlistName(newWatchlist.name);
    return newWatchlist;
  };

  // Delete watchlist
  const deleteWatchlist = async (name: string): Promise<void> => {
    await api.deleteWatchlist(name);
    
    setWatchlists(prev => {
      const filtered = prev.filter(w => w.name !== name);
      // Determine new active watchlist if we just deleted the active one
      if (activeWatchlistName === name) {
        if (filtered.length > 0) {
          // Select first available
          setTimeout(() => setActiveWatchlistName(filtered[0].name), 0);
        } else {
          setTimeout(() => setActiveWatchlistName(null), 0);
        }
      }
      return filtered;
    });
  };

  // Add stock to active watchlist
  const addTickerToActive = async (ticker: string): Promise<void> => {
    if (!activeWatchlistName || !activeWatchlist) {
      // If there are no watchlists, create a default one
      let listToUpdate: Watchlist;
      if (watchlists.length === 0) {
        listToUpdate = await createWatchlist('My Watchlist');
      } else {
        listToUpdate = watchlists[0];
      }
      
      const updatedTickers = [...listToUpdate.tickers];
      if (!updatedTickers.includes(ticker)) {
        updatedTickers.push(ticker);
        const saved = await api.saveWatchlist(listToUpdate.name, updatedTickers);
        setWatchlists(prev => prev.map(w => w.name === saved.name ? saved : w));
      }
      return;
    }

    const updatedTickers = [...activeWatchlist.tickers];
    if (!updatedTickers.includes(ticker)) {
      updatedTickers.push(ticker);
      const saved = await api.saveWatchlist(activeWatchlist.name, updatedTickers);
      setWatchlists(prev => prev.map(w => w.name === saved.name ? saved : w));
    }
  };

  // Remove stock from active watchlist
  const removeTickerFromActive = async (ticker: string): Promise<void> => {
    if (!activeWatchlistName || !activeWatchlist) return;

    const updatedTickers = activeWatchlist.tickers.filter(t => t !== ticker);
    const saved = await api.saveWatchlist(activeWatchlist.name, updatedTickers);
    setWatchlists(prev => prev.map(w => w.name === saved.name ? saved : w));
  };

  // Helper to check if stock is in active watchlist
  const isInActiveWatchlist = (ticker: string): boolean => {
    if (!activeWatchlist) return false;
    return activeWatchlist.tickers.includes(ticker);
  };

  // Fire simulation run
  const runSimulationOnActive = (model: ModelItem | null) => {
    if (!activeWatchlist || activeWatchlist.tickers.length === 0) return;
    
    // Set tickers in text field (e.g. "RELIANCE.NS, TCS.NS")
    setSimulationTickers(activeWatchlist.tickers.join(', '));
    if (model) {
      setSelectedModel(model);
    }
    
    // Set auto-run flag and route to workspace
    setPendingAutoRun(true);
    setActiveTab('simulation');
  };

  // Fire simulation run on a single ticker
  const runSimulationOnTicker = useCallback((ticker: string, model: ModelItem | null) => {
    setSimulationTickers(ticker);
    if (model) {
      setSelectedModel(model);
    }
    
    // Set auto-run flag and route to workspace
    setPendingAutoRun(true);
    setActiveTab('simulation');
  }, []);

  return (
    <WatchlistContext.Provider
      value={{
        watchlists,
        activeWatchlistName,
        activeWatchlist,
        activeTab,
        simulationTickers,
        selectedModel,
        pendingAutoRun,
        setActiveTab,
        setSimulationTickers,
        setSelectedModel,
        setPendingAutoRun,
        setActiveWatchlistName,
        refreshWatchlists,
        createWatchlist,
        deleteWatchlist,
        addTickerToActive,
        removeTickerFromActive,
        isInActiveWatchlist,
        runSimulationOnActive,
        runSimulationOnTicker
      }}
    >
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  const context = useContext(WatchlistContext);
  if (context === undefined) {
    throw new Error('useWatchlist must be used within a WatchlistProvider');
  }
  return context;
}
