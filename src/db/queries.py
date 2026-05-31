import pandas as pd
from sqlalchemy.orm import Session
from src.db.connection import engine, Base
from src.db.models import Stock, DailyPrice, FundamentalsSnapshot, WeeklyPick, WeeklyPipelineRun, SimulationRun, Watchlist

def init_db():
    """Provision database tables if they do not exist."""
    Base.metadata.create_all(bind=engine)
    
    # Run SQLite migration to add watchlist_name columns if they don't exist
    from sqlalchemy import text
    from src.db.connection import SessionLocal
    db = SessionLocal()
    try:
        db.execute(text("ALTER TABLE weekly_picks ADD COLUMN watchlist_name VARCHAR"))
        db.commit()
    except Exception:
        db.rollback()

    weekly_pick_columns = [
        ("analysis_date", "VARCHAR"),
        ("analysis_price", "FLOAT"),
        ("current_price_at_analysis", "FLOAT"),
        ("analysis_details", "TEXT"),
    ]
    for column_name, column_type in weekly_pick_columns:
        try:
            db.execute(text(f"ALTER TABLE weekly_picks ADD COLUMN {column_name} {column_type}"))
            db.commit()
        except Exception:
            db.rollback()
        
    try:
        db.execute(text("ALTER TABLE weekly_pipeline_runs ADD COLUMN watchlist_name VARCHAR"))
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()

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
    risk_score: float,
    watchlist_name: str = "Nifty 500",
    analysis_date: str = None,
    analysis_price: float = None,
    current_price_at_analysis: float = None,
    analysis_details: str = None,
) -> WeeklyPick:
    """Save a weekly pick, updating if it already exists for the week, symbol, and watchlist."""
    query = db.query(WeeklyPick).filter(
        WeeklyPick.week_start_date == week_start_date,
        WeeklyPick.symbol == symbol,
    )
    if watchlist_name == "Nifty 500":
        query = query.filter(
            (WeeklyPick.watchlist_name == "Nifty 500") | (WeeklyPick.watchlist_name == None)
        )
    else:
        query = query.filter(WeeklyPick.watchlist_name == watchlist_name)

    pick = query.first()
    
    if not pick:
        pick = WeeklyPick(
            week_start_date=week_start_date,
            symbol=symbol,
            watchlist_name=watchlist_name
        )
        db.add(pick)
        
    pick.rank = rank
    pick.signal = signal
    pick.score = score
    pick.thesis = thesis
    pick.risk_score = risk_score
    pick.analysis_date = analysis_date or week_start_date
    pick.analysis_price = analysis_price
    pick.current_price_at_analysis = current_price_at_analysis
    pick.analysis_details = analysis_details
    
    db.commit()
    return pick


def delete_weekly_picks(db: Session, week_start_date: str, watchlist_name: str = "Nifty 500") -> int:
    """Delete cached weekly picks for a week and watchlist before replacing the list."""
    query = db.query(WeeklyPick).filter(WeeklyPick.week_start_date == week_start_date)
    if watchlist_name == "Nifty 500":
        query = query.filter(
            (WeeklyPick.watchlist_name == "Nifty 500") | (WeeklyPick.watchlist_name == None)
        )
    else:
        query = query.filter(WeeklyPick.watchlist_name == watchlist_name)

    deleted_count = query.delete(synchronize_session=False)
    db.commit()
    return deleted_count

def get_weekly_picks(db: Session, week_start_date: str, watchlist_name: str = "Nifty 500") -> list[WeeklyPick]:
    """Retrieve all picks for a specific week and watchlist."""
    if watchlist_name == "Nifty 500":
        return db.query(WeeklyPick).filter(
            WeeklyPick.week_start_date == week_start_date,
            (WeeklyPick.watchlist_name == "Nifty 500") | (WeeklyPick.watchlist_name == None)
        ).order_by(WeeklyPick.rank.asc()).all()
    else:
        return db.query(WeeklyPick).filter(
            WeeklyPick.week_start_date == week_start_date,
            WeeklyPick.watchlist_name == watchlist_name
        ).order_by(WeeklyPick.rank.asc()).all()


def create_weekly_run(db: Session, run_date: str, status: str, test_mode: bool, created_at: str, watchlist_name: str = "Nifty 500") -> WeeklyPipelineRun:
    """Create a new weekly pipeline run entry."""
    run = WeeklyPipelineRun(
        run_date=run_date,
        status=status,
        test_mode=test_mode,
        created_at=created_at,
        watchlist_name=watchlist_name
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return run


def update_weekly_run(db: Session, run_id: int, status: str, error_message: str = None) -> WeeklyPipelineRun:
    """Update status of a weekly pipeline run."""
    run = db.query(WeeklyPipelineRun).filter(WeeklyPipelineRun.id == run_id).first()
    if run:
        run.status = status
        if error_message is not None:
            run.error_message = error_message
        db.commit()
        db.refresh(run)
    return run


def get_weekly_runs(db: Session, limit: int = 10) -> list[WeeklyPipelineRun]:
    """Retrieve recent weekly pipeline runs."""
    return db.query(WeeklyPipelineRun).order_by(WeeklyPipelineRun.created_at.desc()).limit(limit).all()


def save_simulation_run(
    db: Session,
    run_id: str,
    created_at: str,
    tickers: str,
    selected_agents: str,
    model_name: str = None,
    model_provider: str = None,
    initial_cash: float = None,
    margin_requirement: float = None,
    status: str = "RUNNING"
) -> SimulationRun:
    """Create or update a simulation run entry."""
    run = db.query(SimulationRun).filter(SimulationRun.id == run_id).first()
    if not run:
        run = SimulationRun(
            id=run_id,
            created_at=created_at,
            tickers=tickers,
            selected_agents=selected_agents,
            model_name=model_name,
            model_provider=model_provider,
            initial_cash=initial_cash,
            margin_requirement=margin_requirement,
            status=status
        )
        db.add(run)
    else:
        run.status = status
    db.commit()
    db.refresh(run)
    return run


def update_simulation_run(
    db: Session,
    run_id: str,
    status: str,
    decisions: str = None,
    analyst_signals: str = None,
    logs: str = None
) -> SimulationRun:
    """Update a simulation run with results and logs."""
    run = db.query(SimulationRun).filter(SimulationRun.id == run_id).first()
    if run:
        run.status = status
        if decisions is not None:
            run.decisions = decisions
        if analyst_signals is not None:
            run.analyst_signals = analyst_signals
        if logs is not None:
            run.logs = logs
        db.commit()
        db.refresh(run)
    return run


def get_simulation_runs(db: Session, limit: int = 20) -> list[SimulationRun]:
    """Retrieve list of past simulation runs."""
    return db.query(SimulationRun).order_by(SimulationRun.created_at.desc()).limit(limit).all()


def get_simulation_run(db: Session, run_id: str) -> SimulationRun:
    """Retrieve full details of a specific simulation run."""
    return db.query(SimulationRun).filter(SimulationRun.id == run_id).first()


def delete_simulation_run(db: Session, run_id: str) -> bool:
    """Delete a simulation run."""
    run = db.query(SimulationRun).filter(SimulationRun.id == run_id).first()
    if run:
        db.delete(run)
        db.commit()
        return True
    return False


def get_watchlists(db: Session) -> list[Watchlist]:
    """Retrieve all watchlists."""
    return db.query(Watchlist).order_by(Watchlist.name.asc()).all()


def get_watchlist_by_name(db: Session, name: str) -> Watchlist:
    """Retrieve a watchlist by name."""
    return db.query(Watchlist).filter(Watchlist.name == name).first()


def create_or_update_watchlist(db: Session, name: str, tickers: list[str]) -> Watchlist:
    """Create or update a named watchlist."""
    import datetime
    watchlist = db.query(Watchlist).filter(Watchlist.name == name).first()
    tickers_str = ",".join(tickers)
    created_at_str = datetime.datetime.now().isoformat()
    if not watchlist:
        watchlist = Watchlist(
            name=name,
            tickers=tickers_str,
            created_at=created_at_str
        )
        db.add(watchlist)
    else:
        watchlist.tickers = tickers_str
    db.commit()
    db.refresh(watchlist)
    return watchlist


def delete_watchlist(db: Session, name: str) -> bool:
    """Delete a watchlist by name."""
    watchlist = db.query(Watchlist).filter(Watchlist.name == name).first()
    if watchlist:
        db.delete(watchlist)
        db.commit()
        return True
    return False
