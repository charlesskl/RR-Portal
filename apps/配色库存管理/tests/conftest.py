import pytest
from app import create_app
from app.extensions import db as _db

class TestConfig:
    SECRET_KEY = "test"
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    TESTING = True

@pytest.fixture
def app():
    app = create_app(TestConfig)
    yield app

@pytest.fixture
def db(app):
    with app.app_context():
        yield _db
        _db.session.remove()

@pytest.fixture
def client(app):
    return app.test_client()
