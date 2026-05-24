import argparse
import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
import yfinance as yf
from sqlalchemy.orm import Session

from src.db.connection import SessionLocal
from src.db.queries import init_db, get_all_stocks, save_fundamentals

def fetch_single_fundamental(symbol: str) -> dict | None:
    """Fetch fundamental metrics for a single stock from yfinance info."""
    try:
        t_obj = yf.Ticker(symbol)
        info = t_obj.info
        if not info or "marketCap" not in info:
            return None
            
        # Parse metrics safely
        market_cap_raw = info.get("marketCap")
        # Convert to Crores
        market_cap = (market_cap_raw / 1e7) if market_cap_raw else None
        
        pe_ratio = info.get("trailingPE") or info.get("forwardPE")
        pb_ratio = info.get("priceToBook")
        
        # yfinance returnOnEquity is decimal (e.g. 0.155 for 15.5%)
        # Convert to percentage for DB consistency
        roe = info.get("returnOnEquity")
        roe_pct = (roe * 100.0) if roe is not None else None
        
        # ROCE proxy using returnOnAssets or returnOnEquity
        roa = info.get("returnOnAssets")
        roce_pct = (roa * 100.0 * 2.0) if roa is not None else roe_pct # simple approximation if ROA is present
        
        # yfinance debtToEquity is percentage (e.g. 36.65 for 0.3665)
        # Convert to decimal ratio for DB consistency
        debt_to_equity_raw = info.get("debtToEquity")
        debt_to_equity = (debt_to_equity_raw / 100.0) if debt_to_equity_raw is not None else None
        
        # yfinance revenueGrowth is decimal (e.g. 0.12 for 12%)
        sales_growth_raw = info.get("revenueGrowth")
        sales_growth_3yr = (sales_growth_raw * 100.0) if sales_growth_raw is not None else None
        
        return {
            "symbol": symbol,
            "metrics": {
                "as_of_date": datetime.datetime.now().strftime("%Y-%m-%d"),
                "market_cap": market_cap,
                "pe_ratio": pe_ratio,
                "pb_ratio": pb_ratio,
                "roe_5yr": roe_pct, # fallbacks
                "roce_5yr": roce_pct,
                "debt_to_equity": debt_to_equity,
                "sales_growth_3yr": sales_growth_3yr,
                "roe_current": roe_pct,
                "roce_current": roce_pct
            }
        }
    except Exception as e:
        print(f"Error fetching fundamentals for {symbol}: {e}")
        return None

def ingest_all_fundamentals(max_workers: int = 15):
    """Fetch fundamentals for all stocks in the database concurrently."""
    init_db()
    db: Session = SessionLocal()
    
    try:
        stocks = get_all_stocks(db)
        symbols = [s.symbol for s in stocks]
        print(f"Starting fundamentals sync for {len(symbols)} stocks using {max_workers} threads...")
        
        success_count = 0
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(fetch_single_fundamental, sym): sym for sym in symbols}
            
            for index, future in enumerate(as_completed(futures)):
                sym = futures[future]
                result = future.result()
                
                if result:
                    save_fundamentals(db, result["symbol"], result["metrics"])
                    success_count += 1
                    
                if (index + 1) % 50 == 0:
                    print(f"Processed {index + 1}/{len(symbols)} stocks...")
                    
        print(f"Successfully synced fundamentals for {success_count}/{len(symbols)} stocks.")
    finally:
        db.close()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Ingest fundamentals from yfinance info")
    parser.add_argument("--workers", type=int, default=15, help="Number of concurrent threads")
    args = parser.parse_args()
    
    ingest_all_fundamentals(max_workers=args.workers)
