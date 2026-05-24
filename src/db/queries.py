import pandas as pd
from sqlalchemy.orm import Session
from src.db.connection import engine, Base
from src.db.models import Stock, DailyPrice, FundamentalsSnapshot, WeeklyPick

def init_db():
    """Provision database tables if they do not exist."""
    Base.metadata.create_all(bind=engine)

def upsert_stock(db: Session, symbol: str, name: str, sector: str = None, is_nifty500: bool = True) -> Stock:
    """Insert or update stock information."""
    stock = db.query(Stock).filter(Stock.symbol == symbol).first()
    if stock:
        stock.name = name
        stock.sector = sector
        stock.is_nifty500 = is_nifty500
    else:
        stock = Stock(symbol=symbol, name=name, sector=sector, is_nifty500=is_nifty500)
        db.add(stock)
    db.commit()
    return stock

def get_all_stocks(db: Session) -> list[Stock]:
    """Retrieve all stock entries."""
    return db.query(Stock).all()

def get_nifty500_stocks(db: Session) -> list[Stock]:
    """Retrieve all Nifty 500 stocks."""
    return db.query(Stock).filter(Stock.is_nifty500 == True).all()

def save_daily_prices(db: Session, symbol: str, prices_df: pd.DataFrame):
    """Save daily OHLCV prices from a pandas DataFrame. Replaces overlapping dates."""
    if prices_df.empty:
        return

    # Delete existing prices in the date range to avoid duplicates
    dates = prices_df.index.strftime("%Y-%m-%d").tolist()
    if dates:
        db.query(DailyPrice).filter(
            DailyPrice.symbol == symbol,
            DailyPrice.date.in_(dates)
        ).delete(synchronize_session=False)

    for date_idx, row in prices_df.iterrows():
        date_str = date_idx.strftime("%Y-%m-%d")
        daily_price = DailyPrice(
            symbol=symbol,
            date=date_str,
            open=float(row["open"]),
            high=float(row["high"]),
            low=float(row["low"]),
            close=float(row["close"]),
            volume=int(row["volume"])
        )
        db.add(daily_price)
    db.commit()

def get_daily_prices(db: Session, symbol: str, start_date: str, end_date: str) -> pd.DataFrame:
    """Retrieve daily price data as a Pandas DataFrame indexed by Date."""
    query = db.query(DailyPrice).filter(
        DailyPrice.symbol == symbol,
        DailyPrice.date >= start_date,
        DailyPrice.date <= end_date
    ).order_by(DailyPrice.date.asc())
    
    results = query.all()
    if not results:
        return pd.DataFrame()
        
    data = []
    for r in results:
        data.append({
            "Date": pd.to_datetime(r.date),
            "open": r.open,
            "high": r.high,
            "low": r.low,
            "close": r.close,
            "volume": r.volume,
            "time": r.date
        })
    df = pd.DataFrame(data).set_index("Date")
    return df

def save_fundamentals(db: Session, symbol: str, metrics: dict):
    """Upsert fundamental snapshot for a stock."""
    snap = db.query(FundamentalsSnapshot).filter(FundamentalsSnapshot.symbol == symbol).first()
    if not snap:
        snap = FundamentalsSnapshot(symbol=symbol)
        db.add(snap)
        
    snap.as_of_date = metrics.get("as_of_date")
    snap.market_cap = metrics.get("market_cap")
    snap.pe_ratio = metrics.get("pe_ratio")
    snap.pb_ratio = metrics.get("pb_ratio")
    snap.roe_5yr = metrics.get("roe_5yr")
    snap.roce_5yr = metrics.get("roce_5yr")
    snap.debt_to_equity = metrics.get("debt_to_equity")
    snap.sales_growth_3yr = metrics.get("sales_growth_3yr")
    snap.roce_current = metrics.get("roce_current")
    snap.roe_current = metrics.get("roe_current")
    
    db.commit()
    return snap

def get_fundamentals(db: Session, symbol: str) -> FundamentalsSnapshot:
    """Retrieve fundamentals snapshot for a stock."""
    return db.query(FundamentalsSnapshot).filter(FundamentalsSnapshot.symbol == symbol).first()

def save_weekly_pick(
    db: Session,
    week_start_date: str,
    symbol: str,
    rank: int,
    signal: str,
    score: float,
    thesis: str,
    risk_score: float
) -> WeeklyPick:
    """Save a weekly pick, updating if it already exists for the week and rank."""
    pick = db.query(WeeklyPick).filter(
        WeeklyPick.week_start_date == week_start_date,
        WeeklyPick.symbol == symbol
    ).first()
    
    if not pick:
        pick = WeeklyPick(
            week_start_date=week_start_date,
            symbol=symbol
        )
        db.add(pick)
        
    pick.rank = rank
    pick.signal = signal
    pick.score = score
    pick.thesis = thesis
    pick.risk_score = risk_score
    
    db.commit()
    return pick

def get_weekly_picks(db: Session, week_start_date: str) -> list[WeeklyPick]:
    """Retrieve all picks for a specific week."""
    return db.query(WeeklyPick).filter(
        WeeklyPick.week_start_date == week_start_date
    ).order_by(WeeklyPick.rank.asc()).all()
