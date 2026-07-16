import { describe, expect, it } from 'vitest'
import { resolvePocketBaseUrl } from '../src/runtimeConfig'

describe('resolvePocketBaseUrl', () => {
  it('生产环境使用门户子路径访问 PocketBase', () => {
    expect(resolvePocketBaseUrl({
      basePath: '/factory-review/',
      dev: false,
      hostname: 'portal.example.com',
      origin: 'https://portal.example.com',
    })).toBe('https://portal.example.com/factory-review/')
  })

  it('开发环境默认连接同主机的 8091 端口', () => {
    expect(resolvePocketBaseUrl({
      basePath: '/',
      dev: true,
      hostname: '192.168.1.8',
      origin: 'http://192.168.1.8:5173',
    })).toBe('http://192.168.1.8:8091')
  })

  it('显式配置优先于默认地址', () => {
    expect(resolvePocketBaseUrl({
      basePath: '/factory-review/',
      dev: true,
      hostname: 'localhost',
      origin: 'http://localhost:5173',
      override: 'http://127.0.0.1:9090',
    })).toBe('http://127.0.0.1:9090')
  })
})
