FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir gunicorn==23.0.0 tzdata
COPY app.py .
CMD ["sh","-c","python app.py && exec gunicorn -w 2 -b 0.0.0.0:8000 app:app"]
