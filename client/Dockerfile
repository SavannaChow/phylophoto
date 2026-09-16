FROM python:3.12-alpine

WORKDIR /app
COPY . /app

ENV PHYLOPHOTO_DATA_ROOT=/data
ENV PHYLOPHOTO_UPLOAD_ROOT=/uploads

EXPOSE 80

CMD ["python", "server.py"]
