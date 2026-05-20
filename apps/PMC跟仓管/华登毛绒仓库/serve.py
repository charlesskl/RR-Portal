"""
生产服务器(waitress)
比 Flask 自带的开发服务器更稳定,适合多人并发访问
"""
from waitress import serve
from app import app


if __name__ == '__main__':
    print('=' * 50)
    print('华登库存管理系统 - 生产服务器')
    print('=' * 50)
    print()
    print('访问地址:')
    print('  本机:        http://localhost:5002')
    print('  局域网其他人: http://<本机IP>:5002')
    print()
    print('按 Ctrl+C 停止服务')
    print('=' * 50)

    serve(app, host='0.0.0.0', port=5002, threads=8)
