FROM python:3.13-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends rclone ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

USER 65532:65532
ENTRYPOINT ["gphoto2mycloud"]
CMD ["--config", "/config/config.toml", "watch"]

