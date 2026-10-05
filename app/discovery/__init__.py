"""Official-API discovery helpers for the credential-backed provider gateway.

`app/api/discovery.py` stays the HTTP surface; the per-provider collectors
(`x_api`, `reddit_api`) and their shared building blocks live here so they can
be unit tested without a web app. Everything in this package is read-only,
in-memory, and talks to fixed official API hosts only.
"""
