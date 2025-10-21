# syntax=docker/dockerfile:1.6
FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY server.py load_test.py ./
RUN mkdir -p content

EXPOSE 8080

CMD ["python", "server.py", "content", "--host", "0.0.0.0", "--port", "8080", "--workers", "8"]
