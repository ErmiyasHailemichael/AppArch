import socket

from flask import Flask, jsonify

app = Flask(__name__)


@app.get("/")
def index():
    return jsonify(
        hostname=socket.gethostname(),
        message="Hello from the private subnet",
    )


@app.get("/healthz")
def healthz():
    return jsonify(status="ok", hostname=socket.gethostname()), 200
