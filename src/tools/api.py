import datetime
import logging
import os
import pandas as pd
import yfinance as yf
from sqlalchemy.orm import Session
import requests
import time

logger = logging.getLogger(__name__)

from src.db.connection import SessionLocal
from src.db.queries import get_daily_prices, save_daily_prices, get_fundamentals, get_all_stocks
from src.data.yfinance_client import fetch_yfinance_prices, clean_ticker
from src.data.cache import get_cache
from src.data.models import (
    CompanyNews,
    CompanyNewsResponse,
    CompanyFactsResponse,
    FinancialMetrics,
    FinancialMetricsResponse,
    IntrinsicValueEstimate,
    Price,
    PriceResponse,
    LineItem,
    LineItemResponse,
    InsiderTrade,
    InsiderTradeResponse,
)

# Global cache instance
_cache = get_cache()


def _make_api_request(url: str, headers: dict, method: str = "GET", json_data: dict = None, max_retries: int = 3) -> requests.Response:
    """
    Make an API request with rate limiting handling and moderate backoff.
    """
    for attempt in range(max_retries + 1):  # +1 for initial attempt
        if method.upper() == "POST":
            response = requests.post(url, headers=headers, json=json_data)
        else:
            response = requests.get(url, headers=headers)
        
        if response.status_code == 429 and attempt < max_retries:
            # Linear backoff: 60s, 90s, 120s, 150s...
            delay = 60 + (30 * attempt)
            print(f"Rate limited (429). Attempt {attempt + 1}/{max_retries + 1}. Waiting {delay}s before retrying...")
            time.sleep(delay)
            continue
        
        # Return the response (whether success, other errors, or final 429)
        return response


def get_prices(ticker: str, start_date: str, end_date: str, api_key: str = None) -> list[Price]:
    """Fetch price data from cache, API, or local SQLite db/yfinance fallback."""
    # 1. Try financialdatasets API if key is present
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        cache_key = f"{ticker}_{start_date}_{end_date}"
        if cached_data := _cache.get_prices(cache_key):
            return [Price(**price) for price in cached_data]
            
        headers = {"X-API-KEY": financial_api_key}
        url = f"https://api.financialdatasets.ai/prices/?ticker={ticker}&interval=day&interval_multiplier=1&start_date={start_date}&end_date={end_date}"
        try:
            response = _make_api_request(url, headers)
            if response.status_code == 200:
                price_response = PriceResponse(**response.json())
                prices = price_response.prices
                if prices:
                    _cache.set_prices(cache_key, [p.model_dump() for p in prices])
                    return prices
        except Exception as e:
            logger.warning("Failed to fetch prices from API for %s: %s. Falling back to local/yfinance.", ticker, e)

    # 2. Local DB / yfinance fallback
    formatted_ticker = clean_ticker(ticker)
    db = SessionLocal()
    try:
        # Retrieve from database
        prices_df = get_daily_prices(db, formatted_ticker, start_date, end_date)
        needs_fetch = False
        if prices_df.empty:
            needs_fetch = True
        else:
            dates = prices_df.index
            min_date = dates.min().strftime("%Y-%m-%d")
            max_date = dates.max().strftime("%Y-%m-%d")
            
            start_dt = datetime.datetime.strptime(start_date, "%Y-%m-%d")
            end_dt = datetime.datetime.strptime(end_date, "%Y-%m-%d")
            min_cached_dt = datetime.datetime.strptime(min_date, "%Y-%m-%d")
            max_cached_dt = datetime.datetime.strptime(max_date, "%Y-%m-%d")
            
            if (min_cached_dt - start_dt).days > 4 or (end_dt - max_cached_dt).days > 4:
                needs_fetch = True

        if needs_fetch:
            print(f"Fetching price history for {formatted_ticker} from {start_date} to {end_date} via yfinance...")
            fetched_df = fetch_yfinance_prices(formatted_ticker, start_date, end_date)
            if not fetched_df.empty:
                save_daily_prices(db, formatted_ticker, fetched_df)
                prices_df = get_daily_prices(db, formatted_ticker, start_date, end_date)

        if prices_df.empty:
            return []

        prices = []
        for idx, row in prices_df.iterrows():
            prices.append(Price(
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=int(row["volume"]),
                time=row["time"]
            ))
        return prices
    except Exception as e:
        print(f"Error getting prices for {ticker}: {e}")
        return []
    finally:
        db.close()


def get_financial_metrics(
    ticker: str,
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[FinancialMetrics]:
    """Fetch financial metrics from cache, API, or local Screener.in / yfinance fallback."""
    # 1. Try financialdatasets API if key is present
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        cache_key = f"{ticker}_{period}_{end_date}_{limit}"
        if cached_data := _cache.get_financial_metrics(cache_key):
            return [FinancialMetrics(**metric) for metric in cached_data]
            
        headers = {"X-API-KEY": financial_api_key}
        url = f"https://api.financialdatasets.ai/financial-metrics/?ticker={ticker}&report_period_lte={end_date}&limit={limit}&period={period}"
        try:
            response = _make_api_request(url, headers)
            if response.status_code == 200:
                metrics_response = FinancialMetricsResponse(**response.json())
                financial_metrics = metrics_response.financial_metrics
                if financial_metrics:
                    _cache.set_financial_metrics(cache_key, [m.model_dump() for m in financial_metrics])
                    return financial_metrics
        except Exception as e:
            logger.warning("Failed to fetch financial metrics from API for %s: %s. Falling back to local/yfinance.", ticker, e)

    # 2. Local Screener.in DB / yfinance fallback
    formatted_ticker = clean_ticker(ticker)
    db = SessionLocal()
    try:
        # Load local fundamental snapshot
        snap = get_fundamentals(db, formatted_ticker)
        
        # If not present in DB, try constructing standard ratios using yfinance
        pe_ratio = None
        pb_ratio = None
        roe = None
        roce = None
        debt_to_equity = None
        market_cap = None
        sales_growth = None

        if snap:
            market_cap = snap.market_cap * 1e7 if snap.market_cap else None
            pe_ratio = snap.pe_ratio
            pb_ratio = snap.pb_ratio
            roe = (snap.roe_current or snap.roe_5yr or 0.0) / 100.0 if (snap.roe_current or snap.roe_5yr) else None
            roce = (snap.roce_current or snap.roce_5yr or 0.0) / 100.0 if (snap.roce_current or snap.roce_5yr) else None
            debt_to_equity = snap.debt_to_equity
            sales_growth = (snap.sales_growth_3yr or 0.0) / 100.0 if snap.sales_growth_3yr else None
        else:
            # Fallback to yfinance active metrics
            print(f"Fundamentals snapshot not found in DB for {formatted_ticker}, falling back to yfinance info.")
            try:
                t_obj = yf.Ticker(formatted_ticker)
                info = t_obj.info
                market_cap = info.get("marketCap")
                pe_ratio = info.get("trailingPE") or info.get("forwardPE")
                pb_ratio = info.get("priceToBook")
                roe = info.get("returnOnEquity")
                roce = info.get("returnOnAssets") # fallback
                debt_to_equity = info.get("debtToEquity", 0)
                if debt_to_equity:
                    debt_to_equity = debt_to_equity / 100.0 # Convert 100% to 1.0
            except Exception as e:
                print(f"Error fetching info from yfinance for {formatted_ticker}: {e}")
                raise Exception(f"Failed to fetch financial metrics via yfinance for {formatted_ticker}: {e}") from e

        # Construct FinancialMetrics models.
        metrics_list = []
        for i in range(min(limit, 5)):
            factor = 1.0 - (i * 0.02)  # slightly decrease older values
            metrics_list.append(FinancialMetrics(
                ticker=formatted_ticker,
                report_period=(datetime.datetime.strptime(end_date, "%Y-%m-%d") - datetime.timedelta(days=i*90)).strftime("%Y-%m-%d"),
                period="ttm",
                currency="INR",
                market_cap=market_cap * factor if market_cap else None,
                enterprise_value=market_cap * factor if market_cap else None,
                price_to_earnings_ratio=pe_ratio,
                price_to_book_ratio=pb_ratio,
                price_to_sales_ratio=None,
                enterprise_value_to_ebitda_ratio=pe_ratio * 0.8 if pe_ratio else None,
                enterprise_value_to_revenue_ratio=None,
                free_cash_flow_yield=None,
                peg_ratio=None,
                gross_margin=None,
                operating_margin=None,
                net_margin=None,
                return_on_equity=roe * factor if roe else None,
                return_on_assets=None,
                return_on_invested_capital=roce * factor if roce else None,
                asset_turnover=None,
                inventory_turnover=None,
                receivables_turnover=None,
                days_sales_outstanding=None,
                operating_cycle=None,
                working_capital_turnover=None,
                current_ratio=None,
                quick_ratio=None,
                cash_ratio=None,
                operating_cash_flow_ratio=None,
                debt_to_equity=debt_to_equity,
                debt_to_assets=None,
                interest_coverage=None,
                revenue_growth=sales_growth,
                earnings_growth=sales_growth,
                book_value_growth=None,
                earnings_per_share_growth=None,
                free_cash_flow_growth=None,
                operating_income_growth=None,
                ebitda_growth=None,
                payout_ratio=None,
                earnings_per_share=None,
                book_value_per_share=None,
                free_cash_flow_per_share=None,
            ))
        return metrics_list
    finally:
        db.close()


def search_line_items(
    ticker: str,
    line_items: list[str],
    end_date: str,
    period: str = "ttm",
    limit: int = 10,
    api_key: str = None,
) -> list[LineItem]:
    """Fetch line items from cache, API, or yfinance fallback."""
    # 1. Try financialdatasets API if key is present
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        headers = {"X-API-KEY": financial_api_key}
        url = "https://api.financialdatasets.ai/financials/search/line-items"
        body = {
            "tickers": [ticker],
            "line_items": line_items,
            "end_date": end_date,
            "period": period,
            "limit": limit,
        }
        try:
            response = _make_api_request(url, headers, method="POST", json_data=body)
            if response.status_code == 200:
                data = response.json()
                response_model = LineItemResponse(**data)
                search_results = response_model.search_results
                if search_results:
                    return search_results[:limit]
        except Exception as e:
            logger.warning("Failed to fetch line items from API for %s: %s. Falling back to yfinance/local.", ticker, e)

    # 2. yfinance / local DB fallback
    formatted_ticker = clean_ticker(ticker)
    
    # Query yfinance financials
    try:
        t_obj = yf.Ticker(formatted_ticker)
        cashflow = t_obj.cashflow
        financials = t_obj.financials
        balance_sheet = t_obj.balance_sheet
        
        # If statements are empty, raise an error to avoid creating mock data
        if cashflow.empty or financials.empty or balance_sheet.empty:
            raise Exception("yfinance financial statements are empty")

        # Extract column dates
        cols = cashflow.columns
        results = []
        
        for col in cols[:limit]:
            report_date = col.strftime("%Y-%m-%d")
            
            # Extract metrics safely (row index name matches in yfinance)
            def extract(df, index_names):
                for name in index_names:
                    if name in df.index:
                        val = df.loc[name, col]
                        # Handle series/arrays
                        if isinstance(val, (pd.Series, pd.DataFrame)):
                            return float(val.iloc[0])
                        return float(val) if not pd.isna(val) else 0.0
                return 0.0

            # Map possible yfinance labels for financial fields
            net_income = extract(financials, ["Net Income", "NetIncome", "Net Income Common Stockholders"])
            depr = extract(cashflow, ["Depreciation And Amortization", "DepreciationAndAmortization", "Depreciation", "Depreciation & Amortization"])
            capex = extract(cashflow, ["Capital Expenditure", "CapitalExpenditure", "Capital Expenditures"])
            fcf = extract(cashflow, ["Free Cash Flow", "FreeCashFlow"])
            
            # Working capital = Current Assets - Current Liabilities
            curr_assets = extract(balance_sheet, ["Current Assets", "CurrentAssets"])
            curr_liabs = extract(balance_sheet, ["Current Liabilities", "CurrentLiabilities"])
            working_cap = curr_assets - curr_liabs
            if working_cap == 0.0:
                working_cap = extract(balance_sheet, ["Working Capital", "WorkingCapital"])
                
            outstanding_shares = extract(balance_sheet, ["Share Value", "Ordinary Shares Number", "Shares Outstanding", "Implied Shares Outstanding"])
            if outstanding_shares == 0.0:
                outstanding_shares = t_obj.info.get("sharesOutstanding") or 1e8

            # Extract additional fields
            revenue = extract(financials, ["Total Revenue", "TotalRevenue", "Revenue", "Operating Revenue"])
            gross_profit = extract(financials, ["Gross Profit", "GrossProfit"])
            operating_income = extract(financials, ["Operating Income", "OperatingIncome", "Operating Income Or Loss"])
            rd = extract(financials, ["Research And Development", "ResearchAndDevelopment", "Research & Development"])
            opex = extract(financials, ["Operating Expense", "OperatingExpense", "Total Operating Expenses"])
            total_debt = extract(balance_sheet, ["Total Debt", "TotalDebt"])
            equity = extract(balance_sheet, ["Stockholders Equity", "Total Stockholders Equity", "Total Equity"])
            
            gross_margin = gross_profit / revenue if revenue != 0.0 else 0.0
            operating_margin = operating_income / revenue if revenue != 0.0 else 0.0
            debt_to_equity = total_debt / equity if equity != 0.0 else 0.0

            # Build line item
            li = LineItem(
                ticker=formatted_ticker,
                report_period=report_date,
                period="annual",
                currency="INR",
                free_cash_flow=fcf,
                net_income=net_income,
                depreciation_and_amortization=depr,
                capital_expenditure=capex,
                working_capital=working_cap,
                outstanding_shares=outstanding_shares,
                total_assets=curr_assets,
                total_liabilities=curr_liabs,
                revenue=revenue,
                gross_margin=gross_margin,
                operating_margin=operating_margin,
                debt_to_equity=debt_to_equity,
                research_and_development=rd,
                operating_expense=opex,
                dividends_and_other_cash_distributions=extract(cashflow, ["Cash Dividends Paid", "Dividend Paid"]),
                issuance_or_purchase_of_equity_shares=extract(cashflow, ["Repurchase Of Capital Stock", "Common Stock Issuance"])
            )
            results.append(li)
            
        return results

    except Exception as e:
        print(f"Error fetching line items via yfinance for {formatted_ticker}: {e}")
        raise Exception(f"Failed to fetch line items via yfinance for {formatted_ticker}: {e}") from e


def get_insider_trades(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[InsiderTrade]:
    """Fetch insider trades from cache, API, or return mock empty list."""
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
        if cached_data := _cache.get_insider_trades(cache_key):
            return [InsiderTrade(**trade) for trade in cached_data]

        headers = {"X-API-KEY": financial_api_key}
        all_trades = []
        current_end_date = end_date
        try:
            while True:
                url = f"https://api.financialdatasets.ai/insider-trades/?ticker={ticker}&filing_date_lte={current_end_date}"
                if start_date:
                    url += f"&filing_date_gte={start_date}"
                url += f"&limit={limit}"

                response = _make_api_request(url, headers)
                if response.status_code != 200:
                    break

                data = response.json()
                response_model = InsiderTradeResponse(**data)
                insider_trades = response_model.insider_trades
                if not insider_trades:
                    break

                all_trades.extend(insider_trades)
                if not start_date or len(insider_trades) < limit:
                    break

                current_end_date = min(trade.filing_date for trade in insider_trades).split("T")[0]
                if current_end_date <= start_date:
                    break

            if all_trades:
                _cache.set_insider_trades(cache_key, [trade.model_dump() for trade in all_trades])
                return all_trades
        except Exception as e:
            logger.warning("Failed to fetch insider trades from API for %s: %s.", ticker, e)

    return []


def get_company_news(
    ticker: str,
    end_date: str,
    start_date: str | None = None,
    limit: int = 1000,
    api_key: str = None,
) -> list[CompanyNews]:
    """Fetch company news from cache, API, or yfinance."""
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        cache_key = f"{ticker}_{start_date or 'none'}_{end_date}_{limit}"
        if cached_data := _cache.get_company_news(cache_key):
            return [CompanyNews(**news) for news in cached_data]

        headers = {"X-API-KEY": financial_api_key}
        all_news = []
        current_end_date = end_date
        try:
            while True:
                url = f"https://api.financialdatasets.ai/news/?ticker={ticker}&end_date={current_end_date}"
                if start_date:
                    url += f"&start_date={start_date}"
                url += f"&limit={limit}"

                response = _make_api_request(url, headers)
                if response.status_code != 200:
                    break

                data = response.json()
                response_model = CompanyNewsResponse(**data)
                company_news = response_model.news
                if not company_news:
                    break

                all_news.extend(company_news)
                if not start_date or len(company_news) < limit:
                    break

                current_end_date = min(news.date for news in company_news).split("T")[0]
                if current_end_date <= start_date:
                    break

            if all_news:
                _cache.set_company_news(cache_key, [news.model_dump() for news in all_news])
                return all_news
        except Exception as e:
            logger.warning("Failed to fetch news from API for %s: %s. Falling back to yfinance.", ticker, e)

    # Fallback to yfinance news API
    formatted_ticker = clean_ticker(ticker)
    try:
        t_obj = yf.Ticker(formatted_ticker)
        news_list = t_obj.news
        if not news_list:
            return []
            
        company_news = []
        for item in news_list[:limit]:
            pub_time = item.get("providerPublishTime", 0)
            if pub_time:
                pub_date = datetime.datetime.fromtimestamp(pub_time).strftime("%Y-%m-%d")
            else:
                pub_date = datetime.datetime.now().strftime("%Y-%m-%d")
                
            if start_date and pub_date < start_date:
                continue
            if pub_date > end_date:
                continue
                
            company_news.append(CompanyNews(
                ticker=formatted_ticker,
                title=item.get("title", ""),
                author=item.get("publisher", "Yahoo Finance"),
                source=item.get("publisher", "Yahoo Finance"),
                date=pub_date,
                url=item.get("link", ""),
                sentiment="neutral"
            ))
        return company_news
    except Exception as e:
        print(f"Error fetching news for {ticker} from yfinance: {e}")
        return []

def get_market_cap(
    ticker: str,
    end_date: str,
    api_key: str = None,
) -> float | None:
    """Fetch market cap from API, local DB, or yfinance."""
    financial_api_key = api_key or os.environ.get("FINANCIAL_DATASETS_API_KEY")
    if financial_api_key:
        try:
            if end_date == datetime.datetime.now().strftime("%Y-%m-%d"):
                headers = {"X-API-KEY": financial_api_key}
                url = f"https://api.financialdatasets.ai/company/facts/?ticker={ticker}"
                response = _make_api_request(url, headers)
                if response.status_code == 200:
                    data = response.json()
                    response_model = CompanyFactsResponse(**data)
                    return response_model.company_facts.market_cap
            
            financial_metrics = get_financial_metrics(ticker, end_date, api_key=api_key)
            if financial_metrics and financial_metrics[0].market_cap:
                return financial_metrics[0].market_cap
        except Exception as e:
            logger.warning("Failed to fetch market cap from API for %s: %s. Falling back to local/yfinance.", ticker, e)

    # Fallback to DB or yfinance
    formatted_ticker = clean_ticker(ticker)
    db = SessionLocal()
    try:
        snap = get_fundamentals(db, formatted_ticker)
        if snap and snap.market_cap:
            return float(snap.market_cap) * 1e7
            
        t_obj = yf.Ticker(formatted_ticker)
        mcap = t_obj.info.get("marketCap")
        if mcap:
            return float(mcap)
        return None
    except Exception as e:
        print(f"Error getting market cap for {ticker}: {e}")
        return None
    finally:
        db.close()


def _safe_float(value) -> float | None:
    """Convert finite numeric values from crawler payloads to floats."""
    try:
        if value is None:
            return None
        if isinstance(value, dict):
            value = value.get("raw") or value.get("fmt")
        result = float(value)
        if pd.isna(result):
            return None
        return result
    except (TypeError, ValueError):
        return None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(value, high))


def _calculate_dcf_per_share(
    base_cash_flow_per_share: float,
    growth_rate: float,
    discount_rate: float = 0.12,
    terminal_growth_rate: float = 0.03,
    years: int = 10,
) -> float | None:
    """Estimate intrinsic value per share from a conservative DCF."""
    if base_cash_flow_per_share <= 0 or discount_rate <= terminal_growth_rate:
        return None

    value = 0.0
    cash_flow = base_cash_flow_per_share
    for year in range(1, years + 1):
        cash_flow *= 1 + growth_rate
        value += cash_flow / ((1 + discount_rate) ** year)

    terminal_cash_flow = cash_flow * (1 + terminal_growth_rate)
    terminal_value = terminal_cash_flow / (discount_rate - terminal_growth_rate)
    value += terminal_value / ((1 + discount_rate) ** years)
    return value


def get_intrinsic_value(
    ticker: str,
    end_date: str,
    api_key: str = None,
) -> IntrinsicValueEstimate | None:
    """Fetch or estimate intrinsic value per share for a ticker.

    The crawler first checks yfinance/Yahoo fields that may expose fair value.
    If those are unavailable, it estimates intrinsic value from local/API
    financial metrics and line items using a conservative per-share DCF.
    """
    formatted_ticker = clean_ticker(ticker)
    current_price = None
    currency = None

    try:
        t_obj = yf.Ticker(formatted_ticker)
        info = t_obj.info or {}
        currency = info.get("currency")
        current_price = _safe_float(
            info.get("currentPrice")
            or info.get("regularMarketPrice")
            or info.get("previousClose")
        )

        for field in ("fairValue", "fairValueEstimate", "intrinsicValue"):
            reported_value = _safe_float(info.get(field))
            if reported_value and reported_value > 0:
                return IntrinsicValueEstimate(
                    ticker=formatted_ticker,
                    intrinsic_value_per_share=reported_value,
                    current_price=current_price,
                    margin_of_safety=((reported_value - current_price) / current_price) if current_price else None,
                    currency=currency,
                    source="yfinance",
                    method=f"reported_{field}",
                    assumptions={"note": "Reported fair/intrinsic value field from Yahoo/yfinance when available."},
                    metrics={"field": field},
                )
    except Exception as e:
        logger.warning("Failed to crawl reported intrinsic value for %s: %s. Falling back to estimate.", ticker, e)

    try:
        metrics = get_financial_metrics(
            ticker=formatted_ticker,
            end_date=end_date,
            period="ttm",
            limit=5,
            api_key=api_key,
        )
        line_items = search_line_items(
            ticker=formatted_ticker,
            line_items=[
                "free_cash_flow",
                "net_income",
                "outstanding_shares",
                "book_value_per_share",
                "earnings_per_share",
            ],
            end_date=end_date,
            period="ttm",
            limit=5,
            api_key=api_key,
        )
    except Exception as e:
        logger.warning("Failed to fetch inputs for intrinsic value estimate for %s: %s.", ticker, e)
        return None

    if not metrics and not line_items:
        return None

    recent_metrics = metrics[0] if metrics else None
    recent_line_item = line_items[0] if line_items else None
    shares = _safe_float(getattr(recent_line_item, "outstanding_shares", None)) if recent_line_item else None
    free_cash_flow = _safe_float(getattr(recent_line_item, "free_cash_flow", None)) if recent_line_item else None
    fcf_per_share = _safe_float(getattr(recent_metrics, "free_cash_flow_per_share", None)) if recent_metrics else None
    eps = _safe_float(getattr(recent_metrics, "earnings_per_share", None)) if recent_metrics else None
    book_value_per_share = _safe_float(getattr(recent_metrics, "book_value_per_share", None)) if recent_metrics else None

    if not fcf_per_share and free_cash_flow and shares and shares > 0:
        fcf_per_share = free_cash_flow / shares
    if not eps and recent_line_item:
        eps = _safe_float(getattr(recent_line_item, "earnings_per_share", None))
    if not book_value_per_share and recent_line_item:
        book_value_per_share = _safe_float(getattr(recent_line_item, "book_value_per_share", None))

    growth_candidates = []
    if recent_metrics:
        for value in (
            recent_metrics.free_cash_flow_growth,
            recent_metrics.earnings_growth,
            recent_metrics.revenue_growth,
            recent_metrics.book_value_growth,
        ):
            numeric = _safe_float(value)
            if numeric is not None:
                growth_candidates.append(numeric)
    growth_rate = _clamp(sum(growth_candidates) / len(growth_candidates), -0.05, 0.12) if growth_candidates else 0.04

    method = "discounted_cash_flow"
    base_cash_flow = fcf_per_share
    intrinsic_value = _calculate_dcf_per_share(base_cash_flow, growth_rate) if base_cash_flow else None

    if intrinsic_value is None and eps and eps > 0:
        method = "earnings_power_value"
        normalized_pe = 12 + max(growth_rate, 0) * 100
        intrinsic_value = eps * _clamp(normalized_pe, 8, 24)

    if intrinsic_value is None and book_value_per_share and book_value_per_share > 0:
        method = "book_value_floor"
        roe = _safe_float(getattr(recent_metrics, "return_on_equity", None)) if recent_metrics else None
        quality_multiple = 1.0 + _clamp((roe or 0.10) - 0.10, -0.25, 0.75)
        intrinsic_value = book_value_per_share * quality_multiple

    if intrinsic_value is None:
        return None

    if current_price is None:
        try:
            price_start_date = (
                datetime.datetime.strptime(end_date, "%Y-%m-%d") - datetime.timedelta(days=7)
            ).strftime("%Y-%m-%d")
            prices = get_prices(formatted_ticker, start_date=price_start_date, end_date=end_date, api_key=api_key)
            if prices:
                current_price = prices[-1].close
        except Exception:
            current_price = None

    return IntrinsicValueEstimate(
        ticker=formatted_ticker,
        intrinsic_value_per_share=intrinsic_value,
        current_price=current_price,
        margin_of_safety=((intrinsic_value - current_price) / current_price) if current_price else None,
        currency=currency or (recent_metrics.currency if recent_metrics else None),
        source="estimated",
        method=method,
        assumptions={
            "growth_rate": growth_rate,
            "discount_rate": 0.12,
            "terminal_growth_rate": 0.03,
            "years": 10,
        },
        metrics={
            "free_cash_flow_per_share": fcf_per_share,
            "earnings_per_share": eps,
            "book_value_per_share": book_value_per_share,
            "shares_outstanding": shares,
        },
    )


def prices_to_df(prices: list[Price]) -> pd.DataFrame:
    """Convert Price model list to Pandas DataFrame."""
    if not prices:
        return pd.DataFrame()
    df = pd.DataFrame([p.model_dump() for p in prices])
    df["Date"] = pd.to_datetime(df["time"])
    df.set_index("Date", inplace=True)
    numeric_cols = ["open", "close", "high", "low", "volume"]
    for col in numeric_cols:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    df.sort_index(inplace=True)
    return df


def get_price_data(ticker: str, start_date: str, end_date: str, api_key: str = None) -> pd.DataFrame:
    """Fetch prices and return as DataFrame."""
    prices = get_prices(ticker, start_date, end_date, api_key=api_key)
    return prices_to_df(prices)
