FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000
WORKDIR /app

COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt

# Deliberately exclude .env, SQLite, raw CSVs and tests from the image.
COPY app ./app
EXPOSE 8000
# Railway supplies PORT at runtime. Exec forwards stop signals to Uvicorn.
CMD ["sh", "-c", "exec python -m uvicorn app.main:app --host 0.0.0.0 --port \"$PORT\" --workers 1"]
