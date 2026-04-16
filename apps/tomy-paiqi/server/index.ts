import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { uploadRouter } from './routes/upload.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Mount upload router at /api
app.use('/api', uploadRouter)

// Health check (used by Docker HEALTHCHECK)
app.get('/health', (_req, res) => {
  res.json({ status: 'healthy' })
})

// Serve static frontend in production
if (process.env.NODE_ENV === 'production') {
  // Bundle: client/dist is next to server.cjs. Dev: client/dist is at ../client/dist
  const candidates = [
    path.join(__dirname, 'client', 'dist'),
    path.join(__dirname, '..', 'client', 'dist'),
  ]
  const clientDist = candidates.find(p => fs.existsSync(p)) ?? candidates[0]
  console.log(`[startup] __dirname: ${__dirname}`)
  console.log(`[startup] clientDist: ${clientDist} (exists: ${fs.existsSync(clientDist)})`)
  app.use(express.static(clientDist))
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app
