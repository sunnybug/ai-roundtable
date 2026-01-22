// AI Panel - Google AI Studio Content Script

(function() {
  'use strict';

  const AI_TYPE = 'aistudio';

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

  // Notify background that content script is ready
  safeSendMessage({ type: 'CONTENT_SCRIPT_READY', aiType: AI_TYPE });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'INJECT_MESSAGE') {
      // Check if already sending to prevent duplicate sends
      if (isSending) {
        console.log('[AI Panel] AI Studio already sending, ignoring duplicate request');
        sendResponse({ success: false, error: 'Already sending a message' });
        return true;
      }
      
      injectMessage(message.message)
        .then(() => sendResponse({ success: true }))
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;
    }

    if (message.type === 'GET_LATEST_RESPONSE') {
      const response = getLatestResponse();
      sendResponse({ content: response });
      return true;
    }
  });

  // Setup response observer for cross-reference feature
  setupResponseObserver();

  async function injectMessage(text) {
    // Prevent duplicate sending
    if (isSending) {
      console.log('[AI Panel] AI Studio already sending, skipping duplicate request');
      return false;
    }
    isSending = true;

    try {
      // Google AI Studio uses a textarea with formcontrolname="promptText"
      const inputSelectors = [
      'textarea[formcontrolname="promptText"]',
      'textarea[placeholder*="Start typing"]',
      'textarea[placeholder*="prompt"]',
      'textarea.cdk-textarea-autosize',
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

    // Set the value
    inputEl.value = text;
    
    // Dispatch events to trigger Angular form control update
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Also trigger Angular's form control update
    const ngControl = inputEl.getAttribute('formcontrolname');
    if (ngControl) {
      // Try to trigger Angular's value change detection
      const inputEvent = new Event('input', { bubbles: true, cancelable: true });
      Object.defineProperty(inputEvent, 'target', { value: inputEl, enumerable: true });
      inputEl.dispatchEvent(inputEvent);
    }

    // Small delay to let the UI process
    await sleep(200);

    // Find and click the Run button
    const runButton = findRunButton();
    if (!runButton) {
      throw new Error('Could not find Run button');
    }

    // Wait for button to be enabled
    await waitForButtonEnabled(runButton);

    runButton.click();

    // Start capturing response after sending
    console.log('[AI Panel] AI Studio message sent, starting response capture...');
    waitForStreamingComplete();

    // Reset sending flag after message is actually sent
    setTimeout(() => {
      isSending = false;
      console.log('[AI Panel] AI Studio sending flag reset');
    }, 2000);

    return true;
    } catch (error) {
      console.error('[AI Panel] AI Studio injection error:', error);
      // Reset flag immediately on error
      isSending = false;
      throw error;
    }
  }

  function findRunButton() {
    // Google AI Studio's Run button
    const selectors = [
      'button[aria-label="Run"]',
      'button[aria-label*="Run"]',
      'button[type="submit"]',
      'ms-run-button button',
      'button:has(span:contains("Run"))'
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      if (el && isVisible(el)) {
        return el.closest('button') || el;
      }
    }

    // Fallback: find button with "Run" text
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
      if ((text.includes('Run') || ariaLabel.includes('run')) && isVisible(btn)) {
        return btn;
      }
    }

    // Last resort: find button near the input area
    const textarea = document.querySelector('textarea[formcontrolname="promptText"]');
    if (textarea) {
      const container = textarea.closest('.prompt-box-container') || textarea.parentElement;
      if (container) {
        const nearbyButtons = container.querySelectorAll('button');
        for (const btn of nearbyButtons) {
          if (isVisible(btn) && !btn.disabled) {
            return btn;
          }
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
        // Also check for attribute changes (like data-turn-role)
        if (mutation.type === 'attributes') {
          const target = mutation.target;
          if (target.classList && (target.classList.contains('chat-turn-container') || 
              target.getAttribute('data-turn-role') === 'Model')) {
            checkForResponse(target);
          }
        }
      }
    });

    const startObserving = () => {
      if (!isContextValid()) return;
      const mainContent = document.querySelector('main, .conversation-container, .response-container') || document.body;
      observer.observe(mainContent, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-turn-role', 'class']
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else {
      startObserving();
    }
  }

  let lastCapturedContent = '';
  let isCapturing = false;  // Prevent multiple captures
  let isSending = false; // Prevent duplicate message sending

  function checkForResponse(node) {
    // Skip if already capturing
    if (isCapturing) return;

    // Check if this node or its children contain a model response
    // Google AI Studio response containers
    const isResponse = node.matches?.('.chat-turn-container.model, [data-turn-role="Model"], .turn-content') ||
                      node.querySelector?.('.chat-turn-container.model, [data-turn-role="Model"], .turn-content') ||
                      node.classList?.contains('chat-turn-container') ||
                      node.classList?.contains('model') ||
                      (node.getAttribute && node.getAttribute('data-turn-role') === 'Model');

    if (isResponse) {
      console.log('[AI Panel] AI Studio detected new response, waiting for completion...');
      waitForStreamingComplete();
    }
  }

  async function waitForStreamingComplete() {
    // Prevent multiple simultaneous captures
    if (isCapturing) {
      console.log('[AI Panel] AI Studio already capturing, skipping...');
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

        // Check if response is complete by looking for completion indicators
        const lastModelTurn = document.querySelector('.chat-turn-container.model:last-of-type, [data-turn-role="Model"]:last-of-type');
        const isComplete = lastModelTurn && (
          // Check for time stamp (indicates completion)
          lastModelTurn.querySelector('.model-run-time-pill') ||
          // Check for feedback buttons (indicates completion)
          lastModelTurn.querySelector('.response-feedback-button') ||
          // Check if turn-footer exists (indicates completion)
          lastModelTurn.querySelector('.turn-footer')
        );

        const currentContent = getLatestResponse() || '';

        // If we have content and it's marked as complete, or content is stable
        if (currentContent.length > 0 && (isComplete || (currentContent === previousContent))) {
          if (isComplete || currentContent === previousContent) {
            stableCount++;
            if (stableCount >= stableThreshold || isComplete) {
              if (currentContent !== lastCapturedContent) {
                lastCapturedContent = currentContent;
                safeSendMessage({
                  type: 'RESPONSE_CAPTURED',
                  aiType: AI_TYPE,
                  content: currentContent
                });
                console.log('[AI Panel] AI Studio response captured, length:', currentContent.length);
              }
              return;
            }
          } else {
            stableCount = 0;
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
    // Google AI Studio response selectors - based on actual HTML structure
    // Look for chat-turn-container with model role
    const modelTurns = document.querySelectorAll('.chat-turn-container.model, [data-turn-role="Model"]');
    
    if (modelTurns.length > 0) {
      // Get the last model turn (most recent response)
      const lastTurn = modelTurns[modelTurns.length - 1];
      
      // Find the turn-content within this turn
      const turnContent = lastTurn.querySelector('.turn-content');
      if (turnContent) {
        // Extract text from ms-prompt-chunk or ms-text-chunk
        const textChunk = turnContent.querySelector('ms-text-chunk, ms-prompt-chunk');
        if (textChunk) {
          const content = textChunk.innerText.trim();
          if (content.length > 10) {
            console.log('[AI Panel] AI Studio response found (from text-chunk), length:', content.length);
            return content;
          }
        }
        
        // Fallback: get all text from turn-content
        const content = turnContent.innerText.trim();
        if (content.length > 10) {
          console.log('[AI Panel] AI Studio response found (from turn-content), length:', content.length);
          return content;
        }
      }
      
      // Fallback: get text from the entire turn container
      const content = lastTurn.innerText.trim();
      if (content.length > 10) {
        // Remove UI elements like "Edit", "Rerun", "Good response", "Bad response", time stamps
        const cleaned = content
          .replace(/Edit|Rerun|Good response|Bad response|\d+\.\d+s/g, '')
          .trim();
        if (cleaned.length > 10) {
          console.log('[AI Panel] AI Studio response found (from turn container), length:', cleaned.length);
          return cleaned;
        }
      }
    }

    // Fallback: look for any text content in the main conversation area
    const mainContent = document.querySelector('main, .conversation-container');
    if (mainContent) {
      // Find all model turns
      const allModelTurns = mainContent.querySelectorAll('.chat-turn-container.model, [data-turn-role="Model"]');
      if (allModelTurns.length > 0) {
        const lastTurn = allModelTurns[allModelTurns.length - 1];
        const content = lastTurn.innerText.trim();
        if (content.length > 10) {
          console.log('[AI Panel] AI Studio response found (fallback), length:', content.length);
          return content;
        }
      }
    }

    console.log('[AI Panel] AI Studio: no response found');
    return null;
  }

  // Utility functions
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

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

  console.log('[AI Panel] AI Studio content script loaded');
})();
