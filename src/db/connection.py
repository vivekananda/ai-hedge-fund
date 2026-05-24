import os
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# Database URL from environment or fallback to local SQLite DB
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///hedge_fund.db")

# Create engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
)

# Create session maker
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Declarative Base
Base = declarative_base()

def get_db():
    """Context manager for DB sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
