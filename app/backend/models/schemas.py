from datetime import datetime, timedelta
from pydantic import BaseModel, Field
from typing import List, Optional
from src.llm.models import ModelProvider


class HedgeFundResponse(BaseModel):
    decisions: dict
    analyst_signals: dict


class ErrorResponse(BaseModel):
    message: str
    error: str | None = None


class HedgeFundRequest(BaseModel):
    tickers: List[str]
    selected_agents: List[str]
    end_date: Optional[str] = Field(default_factory=lambda: datetime.now().strftime("%Y-%m-%d"))
    start_date: Optional[str] = None
    model_name: str = "gpt-4o"
    model_provider: ModelProvider = ModelProvider.OPENAI
    initial_cash: float = 100000.0
    margin_requirement: float = 0.0

    def get_start_date(self) -> str:
        """Calculate start date if not provided"""
        if self.start_date:
            return self.start_date
        return (datetime.strptime(self.end_date, "%Y-%m-%d") - timedelta(days=90)).strftime("%Y-%m-%d")


class StockFundamental(BaseModel):
    as_of_date: Optional[str] = None
    market_cap: Optional[float] = None
    pe_ratio: Optional[float] = None
    pb_ratio: Optional[float] = None
    roe: Optional[float] = None
    roce: Optional[float] = None
    debt_to_equity: Optional[float] = None
    sales_growth_3yr: Optional[float] = None


class StockResponse(BaseModel):
    symbol: str
    name: str
    sector: Optional[str] = None
    performance_1y: Optional[float] = None
    fundamentals: Optional[StockFundamental] = None


class StockPrice(BaseModel):
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int

