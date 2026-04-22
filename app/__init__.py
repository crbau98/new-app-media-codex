from __future__ import annotations

import os

# This app does not rely on third-party Pydantic plugins. Disabling plugin
# discovery avoids expensive distribution scanning during FastAPI import/startup.
os.environ.setdefault("PYDANTIC_DISABLE_PLUGINS", "__all__")
