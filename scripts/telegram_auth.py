"""Run once to generate a Pyrogram StringSession for TELEGRAM_SESSION in .env.

Usage:
    python scripts/telegram_auth.py

Prompts for phone number and verification code, then prints the session string.
Copy the printed string into .env as TELEGRAM_SESSION=<string>.
"""
from __future__ import annotations
import asyncio
from pyrogram import Client
from pyrogram.errors import SessionPasswordNeeded


async def main() -> None:
    api_id_str = input("Enter TELEGRAM_API_ID: ").strip()
    api_hash = input("Enter TELEGRAM_API_HASH: ").strip()
    api_id = int(api_id_str)

    # in_memory=True keeps no file on disk; we export StringSession manually
    async with Client(
        name="auth_session",
        api_id=api_id,
        api_hash=api_hash,
        in_memory=True,
    ) as client:
        session_string = await client.export_session_string()
        print("\n" + "=" * 60)
        print("Add this to your .env file:")
        print(f"TELEGRAM_SESSION={session_string}")
        print("=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
