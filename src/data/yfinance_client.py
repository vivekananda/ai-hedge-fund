import datetime
import pandas as pd
import yfinance as yf

def clean_ticker(ticker: str) -> str:
    """Ensure the ticker has the correct .NS suffix for Indian markets."""
    t = ticker.strip().upper()
    if not t.endswith(".NS") and not t.endswith(".BO"):
        # Default to National Stock Exchange (.NS)
        return f"{t}.NS"
    return t

def fetch_yfinance_prices(ticker: str, start_date: str, end_date: str) -> pd.DataFrame:
    """
    Fetch historical daily OHLCV prices from Yahoo Finance for a given Indian ticker.
    Returns a DataFrame with columns: ['open', 'high', 'low', 'close', 'volume', 'time']
    indexed by Date.
    """
    formatted_ticker = clean_ticker(ticker)
    
    # yfinance date parameters: YYYY-MM-DD
    # Add one day to end_date because yfinance history is exclusive of end date
    end_dt = datetime.datetime.strptime(end_date, "%Y-%m-%d")
    adjusted_end_date = (end_dt + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
    
    ticker_obj = yf.Ticker(formatted_ticker)
    df = ticker_obj.history(start=start_date, end=adjusted_end_date, interval="1d")
    
    if df.empty:
        return pd.DataFrame()
        
    # Reset index to clean up and map column names
    df = df.reset_index()
    df["Date"] = pd.to_datetime(df["Date"]).dt.tz_localize(None)
    df["time"] = df["Date"].dt.strftime("%Y-%m-%d")
    
    df = df.rename(columns={
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Volume": "volume"
    })
    
    # Select only required columns
    df = df[["Date", "open", "high", "low", "close", "volume", "time"]].set_index("Date")
    return df
