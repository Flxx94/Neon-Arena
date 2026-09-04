import { describe, expect, it } from 'vitest'
import { createApp } from './index.js'

describe('GET /health (M0-05)', () => {
  it('antwortet 200 mit status ok', async () => {
    const app = createApp()
    const server = app.listen(0)
    await new Promise<void>((resolve) => server.on('listening', () => resolve()))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`)
      expect(res.status).toBe(200)
      const body = (await res.json()) as { status: string }
      expect(body.status).toBe('ok')
    } finally {
      server.close()
    }
  })
})
