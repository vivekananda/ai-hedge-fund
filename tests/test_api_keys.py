from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.backend.database import get_db
from app.backend.database.models import Base
from app.backend.repositories.api_key_repository import ApiKeyRepository
from app.backend.routes.api_keys import router as api_keys_router
from app.backend.services.api_key_service import ApiKeyService
from src.llm import models
from src.llm.models import ModelProvider


def make_api_keys_client():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app = FastAPI()
    app.include_router(api_keys_router)
    app.dependency_overrides[get_db] = override_get_db

    return TestClient(app), TestingSessionLocal


def test_saves_and_reads_xai_grok_api_key_from_ui_route():
    client, _ = make_api_keys_client()

    response = client.post(
        "/api-keys/",
        json={
            "provider": "XAI_API_KEY",
            "key_value": "xai-test-key",
            "is_active": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "XAI_API_KEY"
    assert response.json()["key_value"] == "xai-test-key"

    response = client.get("/api-keys/XAI_API_KEY")

    assert response.status_code == 200
    assert response.json()["provider"] == "XAI_API_KEY"
    assert response.json()["key_value"] == "xai-test-key"


def test_legacy_grok_provider_is_saved_as_xai_api_key():
    client, SessionLocal = make_api_keys_client()

    response = client.post(
        "/api-keys/",
        json={
            "provider": "GROK_API_KEY",
            "key_value": "legacy-grok-key",
            "is_active": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "XAI_API_KEY"

    response = client.get("/api-keys/GROK_API_KEY")

    assert response.status_code == 200
    assert response.json()["provider"] == "XAI_API_KEY"
    assert response.json()["key_value"] == "legacy-grok-key"

    with SessionLocal() as db:
        keys = ApiKeyRepository(db).get_all_api_keys(include_inactive=True)

    assert len(keys) == 1
    assert keys[0].provider == "XAI_API_KEY"


def test_api_key_service_returns_canonical_xai_key_for_grok_alias():
    _, SessionLocal = make_api_keys_client()

    with SessionLocal() as db:
        repo = ApiKeyRepository(db)
        repo.create_or_update_api_key("GROK_API_KEY", "legacy-grok-key")

        api_keys = ApiKeyService(db).get_api_keys_dict()

    assert api_keys == {"XAI_API_KEY": "legacy-grok-key"}


def test_xai_model_accepts_legacy_grok_api_key_alias(monkeypatch):
    created_models = []

    class FakeChatXAI:
        def __init__(self, **kwargs):
            created_models.append(kwargs)

    monkeypatch.setattr(models, "ChatXAI", FakeChatXAI)
    monkeypatch.delenv("XAI_API_KEY", raising=False)
    monkeypatch.delenv("GROK_API_KEY", raising=False)

    llm = models.get_model(
        "grok-4.3",
        ModelProvider.XAI,
        api_keys={"GROK_API_KEY": "legacy-grok-key"},
    )

    assert isinstance(llm, FakeChatXAI)
    assert created_models == [{"model": "grok-4.3", "api_key": "legacy-grok-key"}]
