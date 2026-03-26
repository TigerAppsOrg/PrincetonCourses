/* global $ */

var chatState = {
  messages: [],
  conversationId: null,
  streaming: false,
  abortController: null,
  userToggledThinking: false
}

// --- Toggle & Layout ---

function toggleChat () {
  $('.navbar-collapse').collapse('hide')
  if (document.isMobile) {
    var isVisible = $('#chat-pane').hasClass('chat-mobile-open')
    if (isVisible) {
      $('#chat-pane').removeClass('chat-mobile-open')
      $('#chat-pane').hide()
    } else {
      $('#chat-pane').addClass('chat-mobile-open')
      $('#chat-pane').show()
      $('#chat-ta').focus()
    }
    return false
  }
  var isVisible = $('#chat-pane').is(':visible')
  if (isVisible) $('#chat-pane').animate({ width: 'hide' })
  else $('#chat-pane').animate({ width: 'show' })
  $('#chat-resizer').removeClass(isVisible ? 'resizer' : 'resizer-inactive')
  $('#chat-resizer').addClass(isVisible ? 'resizer-inactive' : 'resizer')
  if (isVisible) $('#ask-ai-btn').removeClass('active')
  else $('#ask-ai-btn').addClass('active')
  return false
}

function autoResize (el) {
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 120) + 'px'
}

// --- New Conversation ---

function newConversation () {
  if (chatState.streaming) cancelStream()
  chatState.messages = []
  chatState.conversationId = null
  chatState.userToggledThinking = false
  $('#chat-messages').empty()
  appendWelcomeMessage()
  $('#chat-prompts-area').slideDown(150)
  updateSuggestionChips()
}

// --- Cancel / Stop ---

function cancelStream () {
  if (chatState.abortController) {
    chatState.abortController.abort()
    chatState.abortController = null
  }
  setStreamingUI(false)
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

var chatScrollPinned = true

function scrollChatToBottom () {
  if (!chatScrollPinned) return
  var el = document.getElementById('chat-messages')
  if (el) el.scrollTop = el.scrollHeight
}

function initChatScroll () {
  var el = document.getElementById('chat-messages')
  if (!el) return
  el.addEventListener('scroll', function () {
    // Pinned if within 40px of the bottom
    var atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    chatScrollPinned = atBottom
  })
}

function escapeHtml (str) {
  var div = document.createElement('div')
  div.appendChild(document.createTextNode(str))
  return div.innerHTML
}

function getCurrentTerm () {
  var semesterEl = document.getElementById('semester')
  return semesterEl ? semesterEl.value : null
}

// --- Markdown Rendering (marked + highlight.js) ---

var chatMarkedRenderer = (function () {
  /* global marked, hljs */
  var renderer = new marked.Renderer()

  // Code blocks: syntax highlighting, language label, copy button
  renderer.code = function (token) {
    var code = token.text || ''
    var lang = (token.lang || '').trim()
    var highlighted = ''
    if (lang && hljs.getLanguage(lang)) {
      try {
        highlighted = hljs.highlight(code, { language: lang }).value
      } catch (_) {
        highlighted = escapeHtml(code)
      }
    } else {
      highlighted = escapeHtml(code)
    }
    var langLabel = lang ? '<span class="chat-code-lang">' + escapeHtml(lang) + '</span>' : ''
    return '<div class="chat-code-block">' +
      '<div class="chat-code-header">' + langLabel +
      '<button class="chat-code-copy" onclick="copyChatCode(this)">Copy</button>' +
      '</div>' +
      '<pre><code class="hljs' + (lang ? ' language-' + escapeHtml(lang) : '') + '">' +
      highlighted + '</code></pre></div>'
  }

  // Inline code
  renderer.codespan = function (token) {
    return '<code class="chat-inline-code">' + escapeHtml(token.text || '') + '</code>'
  }

  // Links open in new tab
  renderer.link = function (token) {
    return '<a href="' + escapeHtml(token.href || '') + '" target="_blank" rel="noopener noreferrer" class="chat-link">' +
      (token.text || '') + '</a>'
  }

  return renderer
})()

;(function () {
  marked.setOptions({
    renderer: chatMarkedRenderer,
    gfm: true,
    breaks: true
  })
})()

function renderMarkdown (text) {
  try {
    return marked.parse(text)
  } catch (_) {
    return escapeHtml(text)
  }
}

function copyChatCode (btn) {
  var codeEl = btn.closest('.chat-code-block').querySelector('code')
  if (!codeEl) return
  navigator.clipboard.writeText(codeEl.textContent).then(function () {
    btn.textContent = 'Copied!'
    setTimeout(function () { btn.textContent = 'Copy' }, 2000)
  })
}

// --- UI Building ---

function appendWelcomeMessage () {
  var html = '<div class="chat-welcome chat-animate-in">' +
    '<div class="chat-welcome-title">What can I help you find?</div>' +
    '<div class="chat-welcome-subtitle">Ask about courses, workload, ratings, prerequisites, or help finding the right classes.</div>' +
    '</div>'
  $('#chat-messages').append(html)
}

function appendUserMessage (text) {
  var html = '<div class="chat-msg chat-msg-user chat-animate-in">' +
    '<div class="chat-user-bubble">' + escapeHtml(text) + '</div></div>'
  $('#chat-messages').append(html)
  scrollChatToBottom()
}

function createAssistantContainer () {
  var id = 'ai-resp-' + Date.now()
  var html = '<div class="chat-msg chat-msg-ai chat-animate-in" id="' + id + '">' +
    '<div class="chat-ai-body" id="' + id + '-body"></div>' +
    '</div>'
  $('#chat-messages').append(html)
  scrollChatToBottom()
  return id
}

function appendThinkingIndicator (containerId) {
  var thinkId = containerId + '-thinking-' + Date.now()
  var html = '<div class="chat-thinking chat-animate-in" id="' + thinkId + '">' +
    '<div class="chat-thinking-header" onclick="toggleThinking(\'' + thinkId + '\')">' +
    '<span class="chat-collapse-chevron">&#8250;</span>' +
    '<span class="chat-thinking-label">Thinking</span>' +
    '<span class="chat-thinking-dots"><span>.</span><span>.</span><span>.</span></span>' +
    '</div>' +
    '<div class="chat-thinking-content" id="' + thinkId + '-content" style="display:none;"></div>' +
    '</div>'
  $('#' + containerId + '-body').append(html)
  scrollChatToBottom()
  return thinkId
}

function collapseThinking (thinkId) {
  if (chatState.userToggledThinking) return
  var el = $('#' + thinkId + '-content')
  var chevron = el.parent().find('.chat-collapse-chevron').first()
  var label = el.parent().find('.chat-thinking-label').first()
  el.slideUp(150)
  chevron.removeClass('chat-chevron-open')
  label.text('Thought process')
}

function toggleThinking (thinkId) {
  chatState.userToggledThinking = true
  toggleChatCollapse(thinkId + '-content')
}

function appendToolCard (containerId, toolName, args) {
  var toolId = containerId + '-tool-' + Date.now()
  var displayName = toolName.replace(/_/g, ' ')
  var html = '<div class="chat-tool-card chat-animate-in" id="' + toolId + '">' +
    '<div class="chat-tool-header" onclick="toggleChatCollapse(\'' + toolId + '-detail\')">' +
    '<span class="chat-collapse-chevron">&#8250;</span>' +
    '<span class="chat-tool-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg></span>' +
    '<span class="chat-tool-name">' + escapeHtml(displayName) + '<span class="chat-tool-ellipsis">...</span></span>' +
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
  $('#' + toolId + '-status').html('<span class="chat-tool-done"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#5cb85c" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></span>')
  $('#' + toolId).find('.chat-tool-ellipsis').remove()
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
  var sendBtn = document.getElementById('chat-send-btn')
  var stopBtn = document.getElementById('chat-stop-btn')
  var ta = document.getElementById('chat-ta')
  if (ta) ta.disabled = false
  if (active) {
    if (sendBtn) sendBtn.style.display = 'none'
    if (stopBtn) stopBtn.style.display = 'flex'
  } else {
    if (sendBtn) sendBtn.style.display = 'flex'
    if (stopBtn) stopBtn.style.display = 'none'
    if (ta) ta.focus()
  }
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

// --- Suggestion Chips ---

function updateSuggestionChips () {
  var chips = [
    { icon: '\uD83D\uDCA1', text: 'Best courses for beginners?' },
    { icon: '\u2696\uFE0F', text: 'Hardest vs easiest CS courses?' },
    { icon: '\uD83E\uDD16', text: 'Best AI/ML electives?' }
  ]
  var container = document.getElementById('chat-prompt-chips')
  if (!container) return
  container.innerHTML = ''
  for (var i = 0; i < chips.length; i++) {
    var btn = document.createElement('button')
    btn.className = 'chat-prompt-chip'
    btn.setAttribute('data-text', chips[i].text)
    btn.innerHTML = chips[i].icon + ' ' + escapeHtml(chips[i].text) + ' <span style="margin-left:auto; color:#ccc;">\u2192</span>'
    btn.onclick = (function (text) {
      return function () { sendFromChip(text) }
    })(chips[i].text)
    container.appendChild(btn)
  }
}

// --- Core Send Logic (parts-based, like Harness) ---

function sendChatMessage (text) {
  if (!text || !text.trim() || chatState.streaming) return
  text = text.trim()

  // Remove welcome message if present
  $('.chat-welcome').remove()

  chatState.messages.push({ role: 'user', content: text })
  chatState.userToggledThinking = false
  chatScrollPinned = true
  appendUserMessage(text)
  $('#chat-prompts-area').slideUp(150)

  var containerId = createAssistantContainer()

  // Parts array: chronological log of all content blocks
  // Each part: { type: 'reasoning'|'text'|'tool_call', content, domId, toolId, ... }
  var parts = []
  var lastPartType = null
  var fullText = ''

  setStreamingUI(true)

  var controller = new AbortController()
  chatState.abortController = controller

  var payload = { messages: chatState.messages }
  if (chatState.conversationId) payload.conversationId = chatState.conversationId
  var term = getCurrentTerm()
  if (term) payload.term = term
  var modelEl = document.getElementById('chat-model-select')
  if (modelEl && modelEl.value) payload.model = modelEl.value

  // Helper: get or create the current part of a given type
  function ensurePart (type) {
    if (lastPartType === type && parts.length > 0) {
      return parts[parts.length - 1]
    }
    var part = { type: type, content: '', domId: null, toolId: null }
    if (type === 'reasoning') {
      var thinkId = appendThinkingIndicator(containerId)
      part.domId = thinkId
      // Open it for streaming
      var contentEl = document.getElementById(thinkId + '-content')
      if (contentEl) {
        contentEl.style.display = 'block'
        $('#' + thinkId).find('.chat-collapse-chevron').first().addClass('chat-chevron-open')
      }
    } else if (type === 'text') {
      part.domId = appendTextBlock(containerId)
    }
    parts.push(part)
    lastPartType = type
    return part
  }

  // Helper: finalize previous thinking block when type changes away from reasoning
  function finalizePreviousThinking () {
    for (var i = parts.length - 1; i >= 0; i--) {
      if (parts[i].type === 'reasoning' && parts[i].domId) {
        var thinkId = parts[i].domId
        $('#' + thinkId).find('.chat-thinking-dots').remove()
        collapseThinking(thinkId)
        break
      }
    }
  }

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
          // Status events are informational; we let actual content events drive the UI
          break

        case 'thinking':
          var reasoningText = (typeof data === 'object' && data !== null) ? (data.content || '') : String(data)
          if (!reasoningText) break
          if (lastPartType !== 'reasoning') {
            finalizePreviousThinking()
          }
          var part = ensurePart('reasoning')
          part.content += reasoningText
          var thinkContentEl = document.getElementById(part.domId + '-content')
          if (thinkContentEl) {
            thinkContentEl.innerHTML = renderMarkdown(part.content)
          }
          scrollChatToBottom()
          break

        case 'tool_call':
          if (lastPartType === 'reasoning') {
            finalizePreviousThinking()
          }
          var toolArgs = (data && data.arguments) || null
          var toolName = (data && data.name) || 'unknown'
          var toolCallId = (data && data.call_id) || null
          var toolDomId = appendToolCard(containerId, toolName, toolArgs)
          var toolPart = { type: 'tool_call', content: '', domId: toolDomId, toolId: toolCallId, toolName: toolName }
          parts.push(toolPart)
          lastPartType = 'tool_call'
          scrollChatToBottom()
          break

        case 'tool_result':
          // Find the matching tool_call part by name (or the last tool_call)
          var resultName = (data && data.name) || ''
          var resultCallId = (data && data.call_id) || null
          var matchedPart = null
          for (var ti = parts.length - 1; ti >= 0; ti--) {
            if (parts[ti].type === 'tool_call') {
              if (resultCallId && parts[ti].toolId === resultCallId) {
                matchedPart = parts[ti]
                break
              }
              if (resultName && parts[ti].toolName === resultName) {
                matchedPart = parts[ti]
                break
              }
              // Fallback: last unresolved tool_call
              if (!matchedPart) matchedPart = parts[ti]
            }
          }
          if (matchedPart && matchedPart.domId) {
            markToolDone(matchedPart.domId)
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
                $('#' + matchedPart.domId + '-result').html('<pre class="chat-tool-args">' + escapeHtml(resultPreview) + '</pre>')
              }
            }
          }
          break

        case 'token':
          var tokenText = (typeof data === 'object' && data !== null) ? (data.token || data.text || '') : String(data)
          if (!tokenText) break
          if (lastPartType === 'reasoning') {
            finalizePreviousThinking()
          }
          var textPart = ensurePart('text')
          textPart.content += tokenText
          fullText = ''
          // Rebuild fullText from all text parts
          for (var fi = 0; fi < parts.length; fi++) {
            if (parts[fi].type === 'text') fullText += parts[fi].content
          }
          if (textPart.domId) {
            document.getElementById(textPart.domId).innerHTML = renderMarkdown(textPart.content)
          }
          scrollChatToBottom()
          break

        case 'error':
          var errMsg = (typeof data === 'object' && data !== null) ? (data.message || data.error || JSON.stringify(data)) : String(data)
          setStreamingUI(false)
          showErrorInChat(errMsg)
          break

        case 'done':
          // Finalize any open thinking block
          finalizePreviousThinking()
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
            finalizePreviousThinking()
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
    if (err.name === 'AbortError') {
      if (fullText) {
        chatState.messages.push({ role: 'assistant', content: fullText })
      }
      setStreamingUI(false)
      return
    }
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
  // Show welcome message on init
  appendWelcomeMessage()
  updateSuggestionChips()
  initChatScroll()

  $('#chat-send-btn').on('click', function () {
    var ta = document.getElementById('chat-ta')
    var text = ta.value
    ta.value = ''
    ta.style.height = 'auto'
    sendChatMessage(text)
  })

  $('#chat-stop-btn').on('click', function () {
    cancelStream()
  })

  $('#chat-ta').on('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      $('#chat-send-btn').click()
    }
  })

  $('#chat-new-convo').on('click', function () {
    newConversation()
  })
})
