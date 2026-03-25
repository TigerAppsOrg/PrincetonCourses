// handles click in navbar to toggle suggest pane
function toggleChat() {
  if (document.isMobile) {
    $('#main-pane').slick('slickGoTo', 0)
    $('.navbar-collapse').collapse('hide')
    $('#chat-toggle').tooltip('hide')
    $('#chat-toggle').blur()
    return false
  }
  var isVisible = $('#chat-pane').is(':visible')
  if (isVisible) $('#chat-pane').animate({width: 'hide'})
  else $('#chat-pane').animate({width: 'show'})
  $('#chat-resizer').removeClass(isVisible ? 'resizer' : 'resizer-inactive')
  $('#chat-resizer').addClass(isVisible ? 'resizer-inactive' : 'resizer')
  if (isVisible) $('#ask-ai-btn').removeClass('active')
    else $('#ask-ai-btn').addClass('active')
  $('#chat-toggle').attr('data-original-title', isVisible ? 'Open AI chat' : 'Close AI chat')
  $('#chat-toggle').tooltip('hide')
  $('#chat-toggle').blur()
  return false
}

function autoResize(el) { 
  el.style.height = 'auto'; 
  el.style.height = Math.min(el.scrollHeight, 90) + 'px'; 
}