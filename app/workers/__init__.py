"""Background job infrastructure: the outbox relay now, an ARQ/Dramatiq
worker process at multi-instance (blueprint section 9). The event contract
stays identical either way."""

from app.workers.outbox import OutboxRelay

__all__ = ["OutboxRelay"]
