import os
from flask import Flask, jsonify

app = Flask(__name__)


@app.route('/health')
def health():
    return jsonify({'status': 'ok'})


@app.route('/api/tasks')
def tasks():
    return jsonify([
        {'id': 1, 'title': 'Setup CI pipeline', 'done': True},
        {'id': 2, 'title': 'Write tests', 'done': False},
        {'id': 3, 'title': 'Deploy to production', 'done': False},
    ])


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
