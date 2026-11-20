import os

# Tests must never reach live providers, even when a developer's backend/.env
# contains real credentials. Environment variables override .env values.
os.environ["UPSTOX_ACCESS_TOKEN"] = ""
os.environ["AUTO_REFRESH_HOURS"] = "0"
os.environ["LIVE_POLL_SECONDS"] = "0"
os.environ["GOOGLE_CLIENT_ID"] = ""
os.environ["DATA_ADMIN_EMAILS"] = ""
os.environ["BHAVCOPY_WATCH"] = "false"
