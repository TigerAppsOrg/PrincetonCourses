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

// --- Utility ---

function scrollChatToBottom () {
  var el = document.getElementById('chat-messages')
  if (el) el.scrollTop = el.scrollHeight
}

function escapeHtml (str) {
  var div = document.createElement('div')
  div.appendChild(document.createTextNode(str))
  return div.innerHTML
}

// --- Rich Markdown ---

function renderMarkdown (text) {
  var escaped = escapeHtml(text)
  // Headers
  escaped = escaped.replace(/^### (.+)$/gm, '<h4 class="chat-md-h">$1</h4>')
  escaped = escaped.replace(/^## (.+)$/gm, '<h3 class="chat-md-h">$1</h3>')
  // Bold
  escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  escaped = escaped.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // Inline code
  escaped = escaped.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')
  // Bullet lists
  escaped = escaped.replace(/^[-*] (.+)$/gm, '<li class="chat-li">$1</li>')
  escaped = escaped.replace(/((?:<li class="chat-li">.*<\/li>\n?)+)/g, '<ul class="chat-ul">$1</ul>')
  // Numbered lists
  escaped = escaped.replace(/^\d+\. (.+)$/gm, '<li class="chat-li">$1</li>')
  // Line breaks (but not inside block elements)
  escaped = escaped.replace(/\n/g, '<br>')
  // Clean up extra <br> after block elements
  escaped = escaped.replace(/<\/li><br>/g, '</li>')
  escaped = escaped.replace(/<\/ul><br>/g, '</ul>')
  escaped = escaped.replace(/<\/h[34]><br>/g, function (m) { return m.replace('<br>', '') })
  return escaped
}

// --- UI Building ---

function appendUserMessage (text) {
  var html = '<div class="chat-msg chat-msg-user chat-animate-in">' +
    '<div class="chat-user-bubble">' + escapeHtml(text) + '</div></div>'
  $('#chat-messages').append(html)
  scrollChatToBottom()
}

function createAssistantContainer () {
  var id = 'ai-resp-' + Date.now()
  var html = '<div class="chat-msg chat-msg-ai chat-animate-in" id="' + id + '">' +
    '<div class="chat-ai-avatar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EE7F2D" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg></div>' +
    '<div class="chat-ai-body" id="' + id + '-body"></div>' +
    '</div>'
  $('#chat-messages').append(html)
  scrollChatToBottom()
  return id
}

function appendThinkingIndicator (containerId) {
  var thinkId = containerId + '-thinking'
  var html = '<div class="chat-thinking chat-animate-in" id="' + thinkId + '">' +
    '<div class="chat-thinking-header" onclick="toggleChatCollapse(\'' + thinkId + '-content\')">' +
    '<span class="chat-collapse-chevron">&#8250;</span>' +
    '<span class="chat-thinking-label">Thought process</span>' +
    '<span class="chat-thinking-dots"><span>.</span><span>.</span><span>.</span></span>' +
    '</div>' +
    '<div class="chat-thinking-content" id="' + thinkId + '-content" style="display:none;"></div>' +
    '</div>'
  $('#' + containerId + '-body').append(html)
  scrollChatToBottom()
  return thinkId
}

function appendToolCard (containerId, toolName, args) {
  var toolId = containerId + '-tool-' + Date.now()
  var displayName = toolName.replace(/_/g, ' ')
  var html = '<div class="chat-tool-card chat-animate-in" id="' + toolId + '">' +
    '<div class="chat-tool-header" onclick="toggleChatCollapse(\'' + toolId + '-detail\')">' +
    '<span class="chat-collapse-chevron">&#8250;</span>' +
    '<span class="chat-tool-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg></span>' +
    '<span class="chat-tool-name">' + escapeHtml(displayName) + '</span>' +
    '<span class="chat-tool-status" id="' + toolId + '-status"><span class="chat-tool-spinner"></span></span>' +
    '</div>' +
    '<div class="chat-tool-detail" id="' + toolId + '-detail" style="display:none;">' +
    (args ? '<pre class="chat-tool-args">' + escapeHtml(JSON.stringify(args, null, 2)) + '</pre>' : '') +
    '<div class="chat-tool-result" id="' + toolId + '-result"></div>' +
    '</div>' +
    '</div>'
  $('#' + containerId + '-body').append(html)
  scrollChatToBottom()
  return toolId
}

function markToolDone (toolId) {
  $('#' + toolId + '-status').html('<span class="chat-tool-done">Done</span>')
}

function appendTextBlock (containerId) {
  var textId = containerId + '-text-' + Date.now()
  var html = '<div class="chat-text-block chat-animate-in" id="' + textId + '"></div>'
  $('#' + containerId + '-body').append(html)
  return textId
}

function toggleChatCollapse (id) {
  var el = $('#' + id)
  var chevron = el.parent().find('.chat-collapse-chevron').first()
  if (el.is(':visible')) {
    el.slideUp(150)
    chevron.removeClass('chat-chevron-open')
  } else {
    el.slideDown(150)
    chevron.addClass('chat-chevron-open')
  }
}

function setStreamingUI (active) {
  chatState.streaming = active
  var btn = document.getElementById('chat-send-btn')
  var ta = document.getElementById('chat-ta')
  if (btn) btn.disabled = active
  if (ta) ta.disabled = active
  $('#chat-send-btn').css('opacity', active ? '0.4' : '1')
}

function showErrorInChat (msg) {
  var html = '<div class="chat-msg chat-msg-error chat-animate-in">' +
    '<div class="chat-error-bubble">' +
    escapeHtml(msg) +
    ' <button onclick="retryLastMessage()" class="chat-retry-btn">Retry</button>' +
    '</div></div>'
  $('#chat-messages').append(html)
  scrollChatToBottom()
}

// --- Core Send Logic ---

function sendChatMessage (text) {
  if (!text || !text.trim() || chatState.streaming) return
  text = text.trim()

  chatState.messages.push({ role: 'user', content: text })
  appendUserMessage(text)
  $('#chat-prompts-area').slideUp(150)

  var containerId = createAssistantContainer()
  var thinkingId = null
  var currentTextId = null
  var currentToolId = null
  var fullText = ''
  var hasStartedText = false
  var hasThinking = false

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

    var reader = response.body.getReader()
    var decoder = new TextDecoder()

    var parser = createSSEParser(function (eventType, data) {
      switch (eventType) {
        case 'status':
          var phase = (data && data.phase) || ''
          if (phase === 'starting' && !hasThinking) {
            thinkingId = appendThinkingIndicator(containerId)
            hasThinking = true
          }
          if (phase === 'streaming' && thinkingId) {
            $('#' + thinkingId).find('.chat-thinking-dots').remove()
          }
          break

        case 'tool_call':
          if (thinkingId) {
            $('#' + thinkingId).find('.chat-thinking-dots').remove()
          }
          var toolArgs = (data && data.arguments) || null
          var toolName = (data && data.name) || 'unknown'
          currentToolId = appendToolCard(containerId, toolName, toolArgs)
          currentTextId = null
          break

        case 'tool_result':
          if (currentToolId) {
            markToolDone(currentToolId)
            if (data && data.result && data.result.content) {
              var resultPreview = ''
              for (var ci = 0; ci < data.result.content.length; ci++) {
                if (data.result.content[ci].text) {
                  try {
                    var parsed = JSON.parse(data.result.content[ci].text)
                    resultPreview = JSON.stringify(parsed, null, 2)
                  } catch (_) {
                    resultPreview = data.result.content[ci].text
                  }
                }
              }
              if (resultPreview.length > 500) resultPreview = resultPreview.substring(0, 500) + '\n...'
              if (resultPreview) {
                $('#' + currentToolId + '-result').html('<pre class="chat-tool-args">' + escapeHtml(resultPreview) + '</pre>')
              }
            }
            currentToolId = null
          }
          break

        case 'token':
          var tokenText = (typeof data === 'object' && data !== null) ? (data.token || data.text || '') : String(data)
          if (!tokenText) break
          if (!hasStartedText) {
            currentTextId = appendTextBlock(containerId)
            hasStartedText = true
          }
          fullText += tokenText
          if (currentTextId) {
            document.getElementById(currentTextId).innerHTML = renderMarkdown(fullText)
          }
          scrollChatToBottom()
          break

        case 'error':
          var errMsg = (typeof data === 'object' && data !== null) ? (data.message || data.error || JSON.stringify(data)) : String(data)
          setStreamingUI(false)
          showErrorInChat(errMsg)
          break

        case 'done':
          chatState.messages.push({ role: 'assistant', content: fullText })
          if (data && data.conversationId) chatState.conversationId = data.conversationId
          setStreamingUI(false)
          break
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

    return pump()
  }).catch(function (err) {
    if (err.name === 'AbortError') return
    setStreamingUI(false)
    showErrorInChat(err.message || 'Something went wrong')
  })
}

function retryLastMessage () {
  if (chatState.streaming) return
  while (chatState.messages.length > 0 && chatState.messages[chatState.messages.length - 1].role === 'assistant') {
    chatState.messages.pop()
  }
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
