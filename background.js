// AI Panel - Background Service Worker

// URL patterns for each AI
const AI_URL_PATTERNS = {
  claude: ['claude.ai'],
  chatgpt: ['chat.openai.com', 'chatgpt.com'],
  gemini: ['gemini.google.com'],
  chatglm: ['chatglm.cn'],
  aistudio: ['aistudio.google.com']
};

// Store latest responses using chrome.storage.session (persists across service worker restarts)
async function getStoredResponses() {
  const result = await chrome.storage.session.get('latestResponses');
  return result.latestResponses || { claude: null, chatgpt: null, gemini: null, chatglm: null, aistudio: null };
}

async function setStoredResponse(aiType, content) {
  const responses = await getStoredResponses();
  responses[aiType] = content;
  await chrome.storage.session.set({ latestResponses: responses });
}

// Set side panel behavior
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Listen for messages from side panel and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.type) {
    case 'SEND_MESSAGE':
      return await sendMessageToAI(message.aiType, message.message);

    case 'GET_RESPONSE':
      // Query content script directly for real-time response (not from storage)
      return await getResponseFromContentScript(message.aiType);

    case 'RESPONSE_CAPTURED':
      // Content script captured a response
      await setStoredResponse(message.aiType, message.content);
      // Forward to side panel (include content for discussion mode)
      notifySidePanel('RESPONSE_CAPTURED', { aiType: message.aiType, content: message.content });
      return { success: true };

    case 'CONTENT_SCRIPT_READY':
      // Content script loaded and ready
      const aiType = getAITypeFromUrl(sender.tab?.url);
      if (aiType) {
        notifySidePanel('TAB_STATUS_UPDATE', { aiType, connected: true });
      }
      return { success: true };

    default:
      return { error: 'Unknown message type' };
  }
}

async function getResponseFromContentScript(aiType) {
  try {
    const tab = await findAITab(aiType);
    if (!tab) {
      // Fallback to stored response if tab not found
      const responses = await getStoredResponses();
      return { content: responses[aiType] };
    }

    // Query content script for real-time DOM content
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'GET_LATEST_RESPONSE'
    });

    return { content: response?.content || null };
  } catch (err) {
    // Fallback to stored response on error
    console.log('[AI Panel] Failed to get response from content script:', err.message);
    const responses = await getStoredResponses();
    return { content: responses[aiType] };
  }
}

async function sendMessageToAI(aiType, message) {
  try {
    // Find the tab for this AI
    const tab = await findAITab(aiType);

    if (!tab) {
      return { success: false, error: `No ${aiType} tab found` };
    }

    // Try to inject content script if it's not loaded yet
    // This helps with SPA pages that might not have the script loaded
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: [`content/${aiType}.js`]
      });
      // Wait a bit for the script to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (injectErr) {
      // Script might already be injected, or page doesn't match
      console.log(`[AI Panel] Content script injection attempt: ${injectErr.message}`);
    }

    // Send message to content script with retry
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await chrome.tabs.sendMessage(tab.id, {
          type: 'INJECT_MESSAGE',
          message
        });

        // Notify side panel
        notifySidePanel('SEND_RESULT', {
          aiType,
          success: response?.success,
          error: response?.error
        });

        return response;
      } catch (err) {
        lastError = err;
        // If it's a connection error, wait and retry
        if (err.message.includes('Receiving end does not exist') && attempt < 2) {
          console.log(`[AI Panel] Retry ${attempt + 1}/3 for ${aiType}...`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        throw err;
      }
    }

    // If all retries failed
    throw lastError;
  } catch (err) {
    const errorMsg = err.message || 'Unknown error';
    console.error(`[AI Panel] Failed to send to ${aiType}:`, errorMsg);
    
    // Notify side panel of failure
    notifySidePanel('SEND_RESULT', {
      aiType,
      success: false,
      error: errorMsg
    });
    
    return { success: false, error: errorMsg };
  }
}

async function findAITab(aiType) {
  const patterns = AI_URL_PATTERNS[aiType];
  if (!patterns) return null;

  const tabs = await chrome.tabs.query({});

  for (const tab of tabs) {
    if (tab.url && patterns.some(p => tab.url.includes(p))) {
      return tab;
    }
  }

  return null;
}

function getAITypeFromUrl(url) {
  if (!url) return null;
  for (const [aiType, patterns] of Object.entries(AI_URL_PATTERNS)) {
    if (patterns.some(p => url.includes(p))) {
      return aiType;
    }
  }
  return null;
}

async function notifySidePanel(type, data) {
  try {
    await chrome.runtime.sendMessage({ type, ...data });
  } catch (err) {
    // Side panel might not be open, ignore
  }
}

// Track tab updates
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // 当URL变化或页面加载完成时，更新连接状态
  if (changeInfo.url || (changeInfo.status === 'complete' && tab.url)) {
    // 检查所有AI标签页的连接状态
    const tabs = await chrome.tabs.query({});
    const connectedAIs = new Set();
    
    for (const t of tabs) {
      const aiType = getAITypeFromUrl(t.url);
      if (aiType) {
        connectedAIs.add(aiType);
      }
    }
    
    // 通知所有AI类型的连接状态
    for (const aiType of Object.keys(AI_URL_PATTERNS)) {
      const isConnected = connectedAIs.has(aiType);
      notifySidePanel('TAB_STATUS_UPDATE', { aiType, connected: isConnected });
    }
  }
});

// Track tab closures
chrome.tabs.onRemoved.addListener(async (tabId) => {
  // 检查被关闭的标签页是否是AI标签页，并通知侧边栏更新
  // 由于标签页已关闭，我们需要通过检查所有剩余标签页来更新状态
  const tabs = await chrome.tabs.query({});
  const connectedAIs = new Set();
  
  for (const tab of tabs) {
    const aiType = getAITypeFromUrl(tab.url);
    if (aiType) {
      connectedAIs.add(aiType);
    }
  }
  
  // 通知所有AI类型的连接状态
  for (const aiType of Object.keys(AI_URL_PATTERNS)) {
    const isConnected = connectedAIs.has(aiType);
    notifySidePanel('TAB_STATUS_UPDATE', { aiType, connected: isConnected });
  }
});

