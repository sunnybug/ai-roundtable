// AI Panel - ChatGLM Content Script

(function() {
  'use strict';

  const AI_TYPE = 'chatglm';

  // Check if extension context is still valid
  function isContextValid() {
    return chrome.runtime && chrome.runtime.id;
  }

  // Safe message sender that checks context first
  function safeSendMessage(message, callback) {
    if (!isContextValid()) {
      console.log('[AI Panel] Extension context invalidated, skipping message');
      return;
    }
    try {
      chrome.runtime.sendMessage(message, callback);
    } catch (e) {
      console.log('[AI Panel] Failed to send message:', e.message);
    }
  }

  // Listen for messages from background script
  // Use a persistent listener to ensure it's always available
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[AI Panel] ChatGLM received message:', message.type);
    
    if (message.type === 'INJECT_MESSAGE') {
      injectMessage(message.message)
        .then(() => {
          console.log('[AI Panel] ChatGLM message injected successfully');
          sendResponse({ success: true });
        })
        .catch(err => {
          console.error('[AI Panel] ChatGLM injection error:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === 'GET_LATEST_RESPONSE') {
      const response = getLatestResponse();
      sendResponse({ content: response });
      return true;
    }
    
    // Return false if message type is not handled
    return false;
  });

  // Setup response observer for cross-reference feature
  setupResponseObserver();
  
  // Ensure content script is ready even if page loads dynamically
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      console.log('[AI Panel] ChatGLM DOM loaded, content script ready');
      safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });
    });
  } else {
    // Already loaded, send ready message
    console.log('[AI Panel] ChatGLM page already loaded, content script ready');
    safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });
  }

  async function injectMessage(text) {
    // ChatGLM uses various input types - try common selectors
    const inputSelectors = [
      'textarea[placeholder*="输入"]',
      'textarea[placeholder*="请输入"]',
      'textarea[placeholder*="消息"]',
      'div[contenteditable="true"]',
      'textarea[class*="input"]',
      'textarea[class*="message"]',
      'textarea'
    ];

    let inputEl = null;
    for (const selector of inputSelectors) {
      inputEl = document.querySelector(selector);
      if (inputEl && isVisible(inputEl)) break;
    }

    if (!inputEl) {
      throw new Error('Could not find input field');
    }

    // Focus the input
    inputEl.focus();

    // Handle different input types
    if (inputEl.tagName === 'TEXTAREA') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      // Also trigger React/Vue change events
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (nativeInputValueSetter) {
        nativeInputValueSetter.call(inputEl, text);
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    } else {
      // Contenteditable div
      inputEl.textContent = text;
      inputEl.innerText = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('keyup', { bubbles: true }));
    }

    // Small delay to let the UI process
    await sleep(200);

    // Find and click the send button
    const sendButton = findSendButton();
    if (!sendButton) {
      throw new Error('Could not find send button. Available elements: ' + 
        Array.from(document.querySelectorAll('div[class*="enter"], button')).map(el => el.className).join(', '));
    }

    // For div elements (ChatGLM uses div as button), we need to trigger click differently
    if (sendButton.tagName === 'DIV') {
      // Try to find the actual clickable element inside
      const clickableEl = sendButton.querySelector('div, img') || sendButton;
      // Use both click and mousedown/mouseup events
      clickableEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      clickableEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      clickableEl.click();
    } else {
      // Regular button
      await waitForButtonEnabled(sendButton);
      sendButton.click();
    }

    // Start capturing response after sending
    console.log('[AI Panel] ChatGLM message sent, starting response capture...');
    waitForStreamingComplete();

    return true;
  }

  function findSendButton() {
    // ChatGLM's send button - it's a div with enter-icon-container class
    // Based on the HTML structure: <div class="enter is-main-chat"> with <img class="enter_icon" src="/img/send...">
    const selectors = [
      // ChatGLM specific: div with enter-icon-container containing send icon
      'div.enter-icon-container:has(img.enter_icon[src*="send"])',
      'div.enter.is-main-chat .enter-icon-container',
      'div[class*="enter"][class*="main-chat"]',
      // Generic button selectors
      'button[aria-label*="发送"]',
      'button[aria-label*="Send"]',
      'button[type="submit"]',
      'button[class*="send"]',
      'button[class*="submit"]',
      'button svg[viewBox]',
      'button:has(svg)'
    ];

    for (const selector of selectors) {
      try {
        const el = document.querySelector(selector);
        if (el && isVisible(el)) {
          // If it's a div, return it directly (ChatGLM uses div as button)
          if (el.tagName === 'DIV') {
            return el;
          }
          // If it's a button, return it
          return el.closest('button') || el;
        }
      } catch (e) {
        // :has() selector might not be supported, continue
        continue;
      }
    }

    // Fallback: find div with enter-icon-container that contains send icon
    const enterContainers = document.querySelectorAll('div.enter-icon-container, div[class*="enter"]');
    for (const container of enterContainers) {
      const img = container.querySelector('img.enter_icon, img[src*="send"]');
      if (img && isVisible(container)) {
        return container;
      }
    }

    // Fallback: find button near the input
    const form = document.querySelector('form');
    if (form) {
      const buttons = form.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.querySelector('svg') && isVisible(btn)) {
          return btn;
        }
      }
    }

    // Last resort: find button or clickable div at bottom of page
    const clickableElements = document.querySelectorAll('button, div[class*="enter"], div[role="button"]');
    for (const el of clickableElements) {
      const rect = el.getBoundingClientRect();
      if (rect.bottom > window.innerHeight - 150 && isVisible(el)) {
        if (el.querySelector('svg, img[src*="send"]') || el.classList.contains('enter')) {
          return el;
        }
      }
    }

    return null;
  }

  async function waitForButtonEnabled(button, maxWait = 2000) {
    const start = Date.now();
    while (button.disabled && Date.now() - start < maxWait) {
      await sleep(50);
    }
  }

  function setupResponseObserver() {
    const observer = new MutationObserver((mutations) => {
      // Check context validity in observer callback
      if (!isContextValid()) {
        observer.disconnect();
        return;
      }
      for (const mutation of mutations) {
        if (mutation.type === 'childList') {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              checkForResponse(node);
            }
          }
        }
      }
    });

    const startObserving = () => {
      if (!isContextValid()) return;
      // ChatGLM uses various container structures, observe body to catch all changes
      const mainContent = document.querySelector('main, .conversation-container, .chat-container, .answer-content') || document.body;
      observer.observe(mainContent, {
        childList: true,
        subtree: true
      });
      console.log('[AI Panel] ChatGLM observer started on:', mainContent.tagName);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else {
      startObserving();
    }
  }

  let lastCapturedContent = '';
  let isCapturing = false;

  function checkForResponse(node) {
    if (isCapturing) return;

    // Check for response indicators based on ChatGLM's actual HTML structure
    const responseSelectors = [
      '.answer-content-wrap',
      '.answer-content',
      '.assistant-name',
      '[class*="assistant"]',
      '[class*="response"]',
      '[class*="message"][class*="ai"]',
      '[data-role="assistant"]',
      '[data-type="assistant"]'
    ];

    for (const selector of responseSelectors) {
      if (node.matches?.(selector) || node.querySelector?.(selector)) {
        // Check if it's actually a ChatGLM response (contains assistant-name with ChatGLM)
        const assistantName = node.querySelector?.('.assistant-name') || 
                              (node.matches?.('.assistant-name') ? node : null) ||
                              node.closest?.('.answer-content')?.querySelector?.('.assistant-name');
        
        if (assistantName && assistantName.textContent.includes('ChatGLM')) {
          console.log('[AI Panel] ChatGLM detected new response...');
          waitForStreamingComplete();
          break;
        }
      }
    }
  }

  async function waitForStreamingComplete() {
    if (isCapturing) {
      console.log('[AI Panel] ChatGLM already capturing, skipping...');
      return;
    }
    isCapturing = true;

    let previousContent = '';
    let stableCount = 0;
    const maxWait = 600000;  // 10 minutes - AI responses can be very long
    const checkInterval = 500;
    const stableThreshold = 4;  // 2 seconds of stable content

    const startTime = Date.now();

    try {
      while (Date.now() - startTime < maxWait) {
        if (!isContextValid()) {
          console.log('[AI Panel] Context invalidated, stopping capture');
          return;
        }

        await sleep(checkInterval);

        const currentContent = getLatestResponse() || '';

        // Track when content first appears
        if (currentContent.length > 0 && previousContent.length === 0) {
          console.log('[AI Panel] ChatGLM first content detected, length:', currentContent.length);
        }

        // Check for streaming indicators
        const isStreaming = document.querySelector('[class*="streaming"]') ||
                           document.querySelector('[data-streaming="true"]') ||
                           document.querySelector('button[aria-label*="停止"]') ||
                           document.querySelector('button[aria-label*="Stop"]') ||
                           document.querySelector('.advance-thinking:not(.collapse)'); // Thinking mode indicator

        // Content is stable when content unchanged and has content
        const contentStable = currentContent === previousContent && currentContent.length > 0;

        if (!isStreaming && contentStable) {
          stableCount++;
          if (stableCount >= stableThreshold) {
            if (currentContent !== lastCapturedContent) {
              lastCapturedContent = currentContent;
              console.log('[AI Panel] ChatGLM capturing response, length:', currentContent.length);
              safeSendMessage({
                type: 'RESPONSE_CAPTURED',
                aiType: AI_TYPE,
                content: currentContent
              });
              console.log('[AI Panel] ChatGLM response captured and sent!');
            } else {
              console.log('[AI Panel] ChatGLM content same as last capture, skipping');
            }
            return;
          }
        } else {
          stableCount = 0;
        }

        previousContent = currentContent;
      }
    } finally {
      isCapturing = false;
    }
  }

  function getLatestResponse() {
    // Try various selectors for ChatGLM responses based on actual HTML structure
    // ChatGLM uses .answer-content-wrap containing .markdown-body
    const messageSelectors = [
      // Primary: answer-content-wrap with markdown-body (most specific)
      '.answer-content-wrap .markdown-body',
      '.answer-content .markdown-body',
      // Secondary: just markdown-body within answer containers
      '.answer-content-wrap .markdown',
      '.answer-content .markdown',
      // Tertiary: answer-content-wrap itself
      '.answer-content-wrap',
      '.answer-content',
      // Fallback selectors
      '[class*="assistant"][class*="message"]',
      '[class*="response"][class*="ai"]',
      '[data-role="assistant"]',
      '[data-type="assistant"]',
      '[class*="message-content"]',
      'article[class*="assistant"]',
      '.markdown-body',
      '.markdown'
    ];

    let messages = [];
    for (const selector of messageSelectors) {
      messages = document.querySelectorAll(selector);
      if (messages.length > 0) {
        // Filter to only ChatGLM responses (those with assistant-name containing ChatGLM)
        const chatglmMessages = Array.from(messages).filter(msg => {
          const answerContent = msg.closest('.answer-content, .answer-content-wrap');
          if (answerContent) {
            const assistantName = answerContent.querySelector('.assistant-name');
            if (assistantName && assistantName.textContent.includes('ChatGLM')) {
              return true;
            }
          }
          // If no answer-content wrapper, check if it's near a ChatGLM assistant-name
          const nearbyAssistant = msg.closest('[class*="answer"]')?.querySelector('.assistant-name');
          return nearbyAssistant && nearbyAssistant.textContent.includes('ChatGLM');
        });
        
        if (chatglmMessages.length > 0) {
          messages = chatglmMessages;
          break;
        }
      }
    }

    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      // Use innerText to preserve line breaks
      const content = lastMessage.innerText.trim();
      console.log('[AI Panel] ChatGLM response found, length:', content.length);
      return content;
    }

    // Fallback: look for any text content in recent messages
    const allMessages = document.querySelectorAll('[class*="message"], [class*="response"], .answer-content-wrap');
    if (allMessages.length > 0) {
      const lastMessage = allMessages[allMessages.length - 1];
      const content = lastMessage.innerText.trim();
      if (content.length > 0) {
        console.log('[AI Panel] ChatGLM response (fallback), length:', content.length);
        return content;
      }
    }

    console.log('[AI Panel] ChatGLM: no response found');
    return null;
  }

  // Utility functions
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
           style.visibility !== 'hidden' &&
           style.opacity !== '0';
  }

  console.log('[AI Panel] ChatGLM content script loaded');
})();
