FROM python:3.11-slim

# System deps for rasterio/GDAL
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        gdal-bin \
        libgdal-dev \
        proj-bin \
        proj-data \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first for layer caching
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY satellite.py ipfs.py main.py parcels.json ./
COPY scripts ./scripts

ENV PARCELS_PATH=/app/parcels.json
ENV OUTPUT_DIR=/app/output
ENV PYTHONUNBUFFERED=1

# Output dir is a volume mount in compose
RUN mkdir -p /app/output

EXPOSE 9006

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -fsS http://localhost:9006/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "9006"]
