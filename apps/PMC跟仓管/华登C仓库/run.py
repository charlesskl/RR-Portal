"""C仓库 独立版启动入口。

用法:
    python run.py
然后浏览器打开 http://127.0.0.1:5005/
"""
from app import create_app

# gunicorn 入口:gunicorn run:app
app = create_app()

if __name__ == '__main__':
    print('C仓库 已启动 → http://127.0.0.1:5005/')
    app.run(host='127.0.0.1', port=5005, debug=True)
