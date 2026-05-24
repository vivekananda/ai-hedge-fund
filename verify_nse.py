import sys
import datetime
from src.db.connection import SessionLocal
from src.db.queries import get_daily_prices, get_fundamentals
from src.tools.api import get_prices, get_price_data, get_financial_metrics, search_line_items
from src.agents.technicals import calculate_indian_swing_signals

def test_nse_suite():
    print("=== STARTING NSE FUNCTIONAL TESTS ===")
    
    # 1. Test get_prices and caching
    ticker = "RELIANCE.NS"
    start_date = "2026-04-01"
    end_date = "2026-05-15"
    
    print(f"\n1. Testing price fetching for {ticker}...")
    prices = get_prices(ticker, start_date, end_date)
    print(f"   Fetched {len(prices)} prices.")
    if prices:
        print(f"   First price date: {prices[0].time}, Close: {prices[0].close}")
        print(f"   Last price date: {prices[-1].time}, Close: {prices[-1].close}")
    else:
        print("   FAILED: No prices returned.")
        
    # Verify cached data exists in SQLite
    db = SessionLocal()
    cached_prices = get_daily_prices(db, ticker, start_date, end_date)
    print(f"   Cached prices in SQLite count: {len(cached_prices)}")
    db.close()
    
    # 2. Test get_financial_metrics (fallback to yfinance)
    print(f"\n2. Testing get_financial_metrics for {ticker}...")
    metrics = get_financial_metrics(ticker, end_date, limit=2)
    print(f"   Fetched {len(metrics)} metric snapshots.")
    if metrics:
        print(f"   Most recent metrics cap: {metrics[0].market_cap}")
        print(f"   ROE: {metrics[0].return_on_equity}")
        print(f"   D/E Ratio: {metrics[0].debt_to_equity}")
    else:
        print("   FAILED: No metrics returned.")
        
    # 3. Test search_line_items (yfinance statements extraction)
    print(f"\n3. Testing search_line_items for {ticker}...")
    line_items = search_line_items(ticker, ["net_income", "free_cash_flow"], end_date, limit=2)
    print(f"   Fetched {len(line_items)} statement periods.")
    if line_items:
        print(f"   Period 1 Net Income: {line_items[0].__dict__.get('net_income')}")
        print(f"   Period 1 Free Cash Flow: {line_items[0].__dict__.get('free_cash_flow')}")
        print(f"   Period 1 Working Capital: {line_items[0].__dict__.get('working_capital')}")
    else:
        print("   FAILED: No line items returned.")
        
    # 4. Test calculate_indian_swing_signals (44 SMA, RSI, MACD)
    print(f"\n4. Testing Indian swing signals for {ticker}...")
    prices_df = get_price_data(ticker, "2026-01-01", "2026-05-15")
    if not prices_df.empty:
        signals = calculate_indian_swing_signals(prices_df)
        print(f"   Swing Signal: {signals['signal']}")
        print(f"   Confidence: {signals['confidence']}")
        print(f"   Metrics: {signals['metrics']}")
    else:
        print("   FAILED: Could not compute technicals, price df is empty.")
        
    print("\n=== NSE FUNCTIONAL TESTS COMPLETED ===")

if __name__ == "__main__":
    test_nse_suite()
