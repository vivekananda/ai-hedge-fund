import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db.connection import SessionLocal
from src.db.models import WeeklyPick, WeeklyPipelineRun, Stock
from src.db.queries import (
    get_weekly_picks,
    create_weekly_run,
    update_weekly_run,
    get_weekly_runs
)

router = APIRouter(prefix="/weekly-picks")

# Dependency to get db session
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class RunPipelineRequest(BaseModel):
    model_name: Optional[str] = "gemini-2.0-flash"
    model_provider: Optional[str] = "Gemini"
    test_mode: Optional[bool] = False
    watchlist_name: Optional[str] = "Nifty 500"


class WeeklyPickResponse(BaseModel):
    rank: int
    symbol: str
    name: str
    signal: str
    score: float
    thesis: str
    risk_score: float


class WeeklyRunResponse(BaseModel):
    id: int
    run_date: str
    status: str
    error_message: Optional[str] = None
    test_mode: bool
    created_at: str
    watchlist_name: Optional[str] = None


@router.get("/dates", response_model=List[str])
def get_picks_dates(watchlist_name: Optional[str] = "Nifty 500", db: Session = Depends(get_db)):
    """Retrieve all unique dates for which weekly picks exist."""
    try:
        if watchlist_name == "Nifty 500":
            dates = db.query(WeeklyPick.week_start_date).filter(
                (WeeklyPick.watchlist_name == "Nifty 500") | (WeeklyPick.watchlist_name == None)
            ).distinct().all()
        else:
            dates = db.query(WeeklyPick.week_start_date).filter(
                WeeklyPick.watchlist_name == watchlist_name
            ).distinct().all()
        # Sort descending
        return sorted([d[0] for d in dates if d[0]], reverse=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching dates: {str(e)}")


@router.get("/picks/{date}", response_model=List[WeeklyPickResponse])
def get_picks_by_date(date: str, watchlist_name: Optional[str] = "Nifty 500", db: Session = Depends(get_db)):
    """Retrieve all weekly stock picks for a specific date."""
    try:
        picks = get_weekly_picks(db, date, watchlist_name=watchlist_name)
        response = []
        for p in picks:
            # Join with Stock to get name
            stock = db.query(Stock).filter(Stock.symbol == p.symbol).first()
            name = stock.name if stock else p.symbol
            
            response.append(
                WeeklyPickResponse(
                    rank=p.rank,
                    symbol=p.symbol,
                    name=name,
                    signal=p.signal,
                    score=p.score or 0.0,
                    thesis=p.thesis or "",
                    risk_score=p.risk_score or 0.0
                )
            )
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching picks for {date}: {str(e)}")


@router.get("/runs", response_model=List[WeeklyRunResponse])
def get_recent_runs(db: Session = Depends(get_db)):
    """Retrieve the recent background runs of the pipeline."""
    try:
        runs = get_weekly_runs(db)
        return [
            WeeklyRunResponse(
                id=r.id,
                run_date=r.run_date,
                status=r.status,
                error_message=r.error_message,
                test_mode=r.test_mode,
                created_at=r.created_at,
                watchlist_name=r.watchlist_name or "Nifty 500"
            ) for r in runs
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error fetching runs: {str(e)}")


def run_pipeline_wrapper(run_id: int, model_name: str, model_provider: str, test_mode: bool, watchlist_name: str = "Nifty 500"):
    """Wrapper function to execute the weekly picks pipeline in the background and update database state."""
    db = SessionLocal()
    try:
        # Update run status to RUNNING
        update_weekly_run(db, run_id, "RUNNING")
        
        # Import the weekly pipeline function
        from pipelines.weekly_top10 import run_weekly_pipeline
        run_weekly_pipeline(model_name=model_name, model_provider=model_provider, test_mode=test_mode, watchlist_name=watchlist_name)
        
        # Mark as completed
        update_weekly_run(db, run_id, "COMPLETED")
    except Exception as e:
        # Mark as failed with error message
        update_weekly_run(db, run_id, "FAILED", error_message=str(e))
    finally:
        db.close()


@router.post("/run", response_model=WeeklyRunResponse)
def trigger_pipeline(request: RunPipelineRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """Trigger the weekly stock picks pipeline in the background."""
    try:
        # Check if there is already a running pipeline
        active_run = db.query(WeeklyPipelineRun).filter(WeeklyPipelineRun.status == "RUNNING").first()
        if active_run:
            raise HTTPException(
                status_code=400,
                detail=f"A pipeline analysis is already running (started on {active_run.created_at}). Please wait until it completes."
            )
            
        # Create a new run record
        today_str = datetime.date.today().strftime("%Y-%m-%d")
        created_at_str = datetime.datetime.now().isoformat()
        
        run_record = create_weekly_run(
            db=db,
            run_date=today_str,
            status="PENDING",
            test_mode=request.test_mode,
            created_at=created_at_str,
            watchlist_name=request.watchlist_name
        )
        
        # Enqueue the background task
        background_tasks.add_task(
            run_pipeline_wrapper,
            run_id=run_record.id,
            model_name=request.model_name,
            model_provider=request.model_provider,
            test_mode=request.test_mode,
            watchlist_name=request.watchlist_name
        )
        
        return WeeklyRunResponse(
            id=run_record.id,
            run_date=run_record.run_date,
            status=run_record.status,
            error_message=None,
            test_mode=run_record.test_mode,
            created_at=run_record.created_at,
            watchlist_name=run_record.watchlist_name
        )
    except HTTPException as e:
        raise e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error triggering pipeline: {str(e)}")
