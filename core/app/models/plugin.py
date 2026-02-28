from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.database import Base


class Plugin(Base):
    __tablename__ = "plugins"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(50), unique=True, nullable=False, index=True)
    display_name = Column(String(100))
    version = Column(String(20), nullable=False)
    department = Column(String(50))
    description = Column(String(500))
    api_prefix = Column(String(100), nullable=False)
    service_url = Column(String(200), nullable=False)
    health_endpoint = Column(String(200))
    permissions = Column(JSON, default=list)
    config = Column(JSON, default=dict)
    is_enabled = Column(Boolean, default=True)
    status = Column(String(20), default="unknown")  # healthy, unhealthy, unknown
    registered_at = Column(DateTime(timezone=True), server_default=func.now())
    last_health_check = Column(DateTime(timezone=True))
