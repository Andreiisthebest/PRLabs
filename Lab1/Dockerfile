# syntax=docker/dockerfile:1.6
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY server.py client.py ./
COPY content ./content
COPY scripts ./scripts

EXPOSE 8080

CMD ["python", "server.py", "content", "--host", "0.0.0.0", "--port", "8080"]
