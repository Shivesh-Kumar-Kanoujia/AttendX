# AttendX Backend — Dockerfile (for Railway deployment)
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies for pdfplumber
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ .

# Railway provides PORT env var, default to 8000
ENV PORT=8000
ENV ENVIRONMENT=production
ENV HOST=0.0.0.0

EXPOSE $PORT

CMD uvicorn main:app --host $HOST --port $PORT
