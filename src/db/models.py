from sqlalchemy import Column, String, Float, Integer, Boolean, ForeignKey, Date, Text
from sqlalchemy.orm import relationship
from src.db.connection import Base

class Stock(Base):
    __tablename__ = "stocks"

    symbol = Column(String, primary_key=True, index=True)  # e.g., "RELIANCE.NS"
    name = Column(String, nullable=False)
    sector = Column(String, nullable=True)
    is_nifty500 = Column(Boolean, default=True)

    # Relationships
    prices = relationship("DailyPrice", back_populates="stock", cascade="all, delete-orphan")
    fundamentals = relationship("FundamentalsSnapshot", back_populates="stock", cascade="all, delete-orphan", uselist=False)
    weekly_picks = relationship("WeeklyPick", back_populates="stock", cascade="all, delete-orphan")


class DailyPrice(Base):
    __tablename__ = "daily_prices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    symbol = Column(String, ForeignKey("stocks.symbol"), nullable=False, index=True)
    date = Column(String, nullable=False, index=True)  # YYYY-MM-DD format
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Integer, nullable=False)

    stock = relationship("Stock", back_populates="prices")


class FundamentalsSnapshot(Base):
    __tablename__ = "fundamentals_snapshots"

    symbol = Column(String, ForeignKey("stocks.symbol"), primary_key=True)
    as_of_date = Column(String, nullable=False)  # YYYY-MM-DD
    market_cap = Column(Float, nullable=True)     # In Crores or raw INR
    pe_ratio = Column(Float, nullable=True)
    pb_ratio = Column(Float, nullable=True)
    roe_5yr = Column(Float, nullable=True)        # % (e.g. 15.5 for 15.5%)
    roce_5yr = Column(Float, nullable=True)      # %
    debt_to_equity = Column(Float, nullable=True) # Ratio
    sales_growth_3yr = Column(Float, nullable=True) # %
    roce_current = Column(Float, nullable=True)   # %
    roe_current = Column(Float, nullable=True)     # %

    stock = relationship("Stock", back_populates="fundamentals")


class WeeklyPick(Base):
    __tablename__ = "weekly_picks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    week_start_date = Column(String, nullable=False, index=True)  # YYYY-MM-DD
    symbol = Column(String, ForeignKey("stocks.symbol"), nullable=False, index=True)
    rank = Column(Integer, nullable=False)
    signal = Column(String, nullable=False)  # e.g., "bullish"
    score = Column(Float, nullable=True)     # Overall score
    thesis = Column(Text, nullable=True)     # LLM thesis
    risk_score = Column(Float, nullable=True) # Qualitative risk score

    stock = relationship("Stock", back_populates="weekly_picks")
