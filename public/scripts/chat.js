/* global $ */

var chatState = {
  messages: [],
  conversationId: null,
  streaming: false,
  abortController: null
}

function toggleChat () {
  if (document.isMobile) {
    $('#main-pane').slick('slickGoTo', 0)
    $('.navbar-collapse').collapse('hide')
    $('#chat-toggle').tooltip('hide')
    $('#chat-toggle').blur()
    return false
  }
  var isVisible = $('#chat-pane').is(':visible')
  if (isVisible) $('#chat-pane').animate({ width: 'hide' })
  else $('#chat-pane').animate({ width: 'show' })
  $('#chat-resizer').removeClass(isVisible ? 'resizer' : 'resizer-inactive')
  $('#chat-resizer').addClass(isVisible ? 'resizer-inactive' : 'resizer')
  if (isVisible) $('#ask-ai-btn').removeClass('active')
  else $('#ask-ai-btn').addClass('active')
  $('#chat-toggle').attr('data-original-title', isVisible ? 'Open AI chat' : 'Close AI chat')
  $('#chat-toggle').tooltip('hide')
  $('#chat-toggle').blur()
  return false
}

function autoResize (el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 90) + 'px'
}

// --- SSE Parser ---

function createSSEParser (onEvent) {
  var buffer = ''
  return {
    feed: function (chunk) {
      buffer += chunk
      var frames = buffer.split('\n\n')
      buffer = frames.pop()
      for (var i = 0; i < frames.length; i++) {
        var frame = frames[i].trim()
        if (!frame) continue
        var eventType = 'message'
        var dataLines = []
        var lines = frame.split('\n')
        for (var j = 0; j < lines.length; j++) {
          var line = lines[j]
          if (line.indexOf('event:') === 0) {
            eventType = line.slice(6).trim()
          } else if (line.indexOf('data:') === 0) {
            dataLines.push(line.slice(5).trim())
          }
        }
        if (dataLines.length > 0) {
          var raw = dataLines.join('\n')
          var parsed = null
          try { parsed = JSON.parse(raw) } catch (_) { parsed = raw }
          onEvent(eventType, parsed, raw)
        }
      }
    }
  }
}

// --- UI Helpers ---

function scrollChatToBottom () {
  var el = document.getElementById('chat-messages')
  if (el) el.scrollTop = el.scrollHeight
}

function appendUserMessage (text) {
  var html = '<div class="chat-msg chat-msg-user" style="margin: 8px 0; text-align: right;">' +
    '<div style="display: inline-block; max-width: 85%; background: #1a1a1a; color: #fff; padding: 8px 12px; border-radius: 12px 12px 2px 12px; font-size: 0.95rem; text-align: left; white-space: pre-wrap;">' +
    escapeHtml(text) + '</div></div>'
  $('#chat-messages').append(html)
  scrollChatToBottom()
}

function createAssistantBubble () {
  var id = 'ai-msg-' + Date.now()
  var html = '<div class="chat-msg chat-msg-ai" style="margin: 8px 0;">' +
    '<div style="display: flex; align-items: flex-start; gap: 6px;">' +
    '<span id="ai-bot-dot" style="margin-top: 6px;"></span>' +
    '<div id="' + id + '" style="max-width: 85%; background: #f5f5f5; padding: 8px 12px; border-radius: 2px 12px 12px 12px; font-size: 0.95rem; white-space: pre-wrap; word-break: break-word;"></div>' +
    '</div>' +
    '<div id="' + id + '-status" style="font-size: 0.75rem; color: #999; margin: 2px 0 0 18px;"></div>' +
    '</div>'
  $('#chat-messages').append(html)
  scrollChatToBottom()
  return id
}

function setStreamingUI (active) {
  chatState.streaming = active
  var btn = document.getElementById('chat-send-btn')
  var ta = document.getElementById('chat-ta')
  if (btn) btn.disabled = active
  if (ta) ta.disabled = active
  if (active) {
    $('#chat-send-btn').css('opacity', '0.4')
  } else {
    $('#chat-send-btn').css('opacity', '1')
  }
}

function showErrorInChat (msg) {
  var html = '<div class="chat-msg chat-msg-error" style="margin: 8px 0;">' +
    '<div style="display: inline-block; max-width: 85%; background: #fff0f0; color: #c00; padding: 8px 12px; border-radius: 8px; font-size: 0.9rem; border: 1px solid #fcc;">' +
    escapeHtml(msg) +
    ' <button onclick="retryLastMessage()" style="margin-left: 8px; background: none; border: 1px solid #c00; color: #c00; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 0.85rem;">Retry</button>' +
    '</div></div>'
  $('#chat-messages').append(html)
  scrollChatToBottom()
}

function escapeHtml (str) {
  var div = document.createElement('div')
  div.appendChild(document.createTextNode(str))
  return div.innerHTML
}

// --- Core Send Logic ---

function sendChatMessage (text) {
  if (!text || !text.trim() || chatState.streaming) return
  text = text.trim()

  chatState.messages.push({ role: 'user', content: text })
  appendUserMessage(text)

  $('#chat-prompts-area').hide()

  var bubbleId = createAssistantBubble()
  setStreamingUI(true)

  var controller = new AbortController()
  chatState.abortController = controller

  var payload = { messages: chatState.messages }
  if (chatState.conversationId) payload.conversationId = chatState.conversationId

  fetch('/api/ask-ai/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal
  }).then(function (response) {
    if (!response.ok) {
      return response.json().then(function (err) {
        throw new Error(err.error || err.detail || 'Request failed (' + response.status + ')')
      }).catch(function (parseErr) {
        if (parseErr.message && parseErr.message !== 'Request failed (' + response.status + ')') throw parseErr
        throw new Error('Request failed (' + response.status + ')')
      })
    }
    return streamResponse(response, bubbleId)
  }).catch(function (err) {
    if (err.name === 'AbortError') return
    setStreamingUI(false)
    showErrorInChat(err.message || 'Something went wrong')
  })
}

function streamResponse (response, bubbleId) {
  var reader = response.body.getReader()
  var decoder = new TextDecoder()
  var fullText = ''

  var parser = createSSEParser(function (eventType, data) {
    switch (eventType) {
      case 'token':
        var tokenText = (typeof data === 'object' && data !== null) ? (data.token || data.text || '') : String(data)
        fullText += tokenText
        document.getElementById(bubbleId).innerHTML = renderMarkdownBasic(fullText)
        scrollChatToBottom()
        break

      case 'status':
        var statusText = (typeof data === 'object' && data !== null) ? (data.status || data.message || JSON.stringify(data)) : String(data)
        $('#' + bubbleId + '-status').text(statusText)
        break

      case 'tool_call':
        $('#' + bubbleId + '-status').text('Using tool: ' + ((data && data.name) || 'unknown') + '...')
        break

      case 'tool_result':
        $('#' + bubbleId + '-status').text('')
        break

      case 'error':
        var errMsg = (typeof data === 'object' && data !== null) ? (data.message || data.error || JSON.stringify(data)) : String(data)
        setStreamingUI(false)
        showErrorInChat(errMsg)
        return

      case 'done':
        chatState.messages.push({ role: 'assistant', content: fullText })
        if (data && data.conversationId) chatState.conversationId = data.conversationId
        $('#' + bubbleId + '-status').text('')
        setStreamingUI(false)
        return
    }
  })

  function pump () {
    return reader.read().then(function (result) {
      if (result.done) {
        if (chatState.streaming) {
          chatState.messages.push({ role: 'assistant', content: fullText })
          setStreamingUI(false)
        }
        return
      }
      parser.feed(decoder.decode(result.value, { stream: true }))
      return pump()
    })
  }

  return pump().catch(function (err) {
    if (err.name !== 'AbortError') {
      setStreamingUI(false)
      showErrorInChat('Stream error: ' + err.message)
    }
  })
}

function retryLastMessage () {
  if (chatState.streaming) return
  // Remove the last assistant message attempt + error from history
  while (chatState.messages.length > 0 && chatState.messages[chatState.messages.length - 1].role === 'assistant') {
    chatState.messages.pop()
  }
  // Remove error and failed bubble from DOM
  $('.chat-msg-error:last').remove()
  $('.chat-msg-ai:last').remove()

  var lastUserMsg = chatState.messages.length > 0 ? chatState.messages[chatState.messages.length - 1] : null
  if (lastUserMsg && lastUserMsg.role === 'user') {
    chatState.messages.pop()
    sendChatMessage(lastUserMsg.content)
  }
}

function sendFromChip (text) {
  document.getElementById('chat-ta').value = ''
  sendChatMessage(text)
}

function renderMarkdownBasic (text) {
  var escaped = escapeHtml(text)
  // Bold
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Inline code
  escaped = escaped.replace(/`([^`]+)`/g, '<code style="background:#e8e8e8;padding:1px 4px;border-radius:3px;font-size:0.9em;">$1</code>')
  // Line breaks
  escaped = escaped.replace(/\n/g, '<br>')
  return escaped
}

// --- Event Bindings ---

$(function () {
  $('#chat-send-btn').on('click', function () {
    var ta = document.getElementById('chat-ta')
    var text = ta.value
    ta.value = ''
    ta.style.height = 'auto'
    sendChatMessage(text)
  })

  $('#chat-ta').on('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      $('#chat-send-btn').click()
    }
  })
})
