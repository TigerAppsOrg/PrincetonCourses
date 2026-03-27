let express = require('express')
let router = express.Router()
let config = require('../config')

router.post('/stream', async function (req, res) {
  let user = res.locals.user
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  let { messages, conversationId, term, model } = req.body
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' })
  }

  let gatewayURL = config.askGatewayURL + '/ask/stream'
  let headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream'
  }
  if (config.askGatewayToken) {
    headers['Authorization'] = 'Bearer ' + config.askGatewayToken
  }
  headers['x-external-user-id'] = user._id

  let body = { messages }
  if (conversationId) body.conversationId = conversationId
  if (term) body.term = term
  if (model) body.model = model
  // Inject CAS NetID server-side for TigerJunction schedule access
  if (user._id) body.netid = user._id

  try {
    let upstream = await fetch(gatewayURL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    })

    if (!upstream.ok) {
      let errText = ''
      try { errText = await upstream.text() } catch (_) {}
      return res.status(upstream.status).json({
        error: 'Ask Gateway error',
        status: upstream.status,
        detail: errText
      })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    let reader = upstream.body.getReader()
    let decoder = new TextDecoder()

    try {
      while (true) {
        let { done, value } = await reader.read()
        if (done) break
        res.write(decoder.decode(value, { stream: true }))
      }
    } catch (streamErr) {
      if (!res.writableEnded) {
        res.write('event: error\ndata: {"message":"Stream interrupted"}\n\n')
      }
    }

    res.end()
  } catch (err) {
    if (!res.headersSent) {
      return res.status(502).json({
        error: 'Failed to connect to Ask Gateway',
        detail: err.message
      })
    }
    if (!res.writableEnded) {
      res.write('event: error\ndata: ' + JSON.stringify({ message: err.message }) + '\n\n')
      res.end()
    }
  }
})

router.get('/conversations', async function (req, res) {
  let user = res.locals.user
  if (!user) return res.status(401).json({ error: 'Authentication required' })

  let url = config.askGatewayURL + '/ask/conversations?netid=' + encodeURIComponent(user._id)
  let headers = {}
  if (config.askGatewayToken) headers['Authorization'] = 'Bearer ' + config.askGatewayToken

  try {
    let upstream = await fetch(url, { headers })
    let data = await upstream.json()
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: 'Failed to get conversations', detail: err.message })
  }
})

router.get('/conversations/:id/messages', async function (req, res) {
  let user = res.locals.user
  if (!user) return res.status(401).json({ error: 'Authentication required' })

  let url = config.askGatewayURL + '/ask/conversations/' + encodeURIComponent(req.params.id) + '/messages?netid=' + encodeURIComponent(user._id)
  let headers = {}
  if (config.askGatewayToken) headers['Authorization'] = 'Bearer ' + config.askGatewayToken

  try {
    let upstream = await fetch(url, { headers })
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'Not found' })
    let data = await upstream.json()
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: 'Failed to get messages', detail: err.message })
  }
})

router.get('/quota', async function (req, res) {
  let user = res.locals.user
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  let quotaURL = config.askGatewayURL + '/ask/quota?netid=' + encodeURIComponent(user._id)
  let headers = {}
  if (config.askGatewayToken) {
    headers['Authorization'] = 'Bearer ' + config.askGatewayToken
  }

  try {
    let upstream = await fetch(quotaURL, { headers })
    let data = await upstream.json()
    res.json(data)
  } catch (err) {
    res.status(502).json({ error: 'Failed to get quota', detail: err.message })
  }
})

module.exports = router
