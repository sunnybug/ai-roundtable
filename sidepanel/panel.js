// AI Panel - Side Panel Controller

const AI_TYPES = ['claude', 'chatgpt', 'gemini', 'chatglm', 'aistudio'];

// DOM Elements
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const logContainer = document.getElementById('log-container');

// Track connected tabs
const connectedTabs = {
  claude: null,
  chatgpt: null,
  gemini: null,
  chatglm: null,
  aistudio: null
};

// Cache for visible AIs
let visibleAIsCache = {
  claude: true,
  chatgpt: true,
  gemini: true,
  chatglm: true,
  aistudio: true
};

// Discussion Mode State
let discussionState = {
  active: false,
  topic: '',
  participants: [],  // [ai1, ai2]
  currentRound: 0,
  history: [],  // [{round, ai, type: 'initial'|'evaluation'|'response', content}]
  pendingResponses: new Set(),  // AIs we're waiting for
  roundType: null  // 'initial', 'cross-eval', 'counter'
};

// Track AI response status
const aiResponseStatus = {
  claude: false,
  chatgpt: false,
  gemini: false,
  chatglm: false,
  aistudio: false
};


// Initialize
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  setupDiscussionMode();
  setupSettings();
  setupMutualReview();
  displayBuildTime();
  loadAndApplyVisibleAIs();
  checkConnectedTabs(); // 在加载配置后检查连接状态，会自动应用显示逻辑
  restoreSelectedAIs(); // 恢复用户的选中状态
  // 启动定时刷新连接状态
  startConnectionRefresh();
});

function setupEventListeners() {
  sendBtn.addEventListener('click', handleSend);

  // 移动标签到新窗口按钮
  const moveTabsBtn = document.getElementById('move-tabs-btn');
  if (moveTabsBtn) {
    moveTabsBtn.addEventListener('click', moveTabsToNewWindow);
  }

  // Enter to send, Shift+Enter for new line (like ChatGPT)
  // But ignore Enter during IME composition (e.g., Chinese input)
  messageInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      handleSend();
    }
  });

  // Save selected AIs when checkbox changes
  AI_TYPES.forEach(aiType => {
    const checkbox = document.getElementById(`target-${aiType}`);
    if (checkbox) {
      checkbox.addEventListener('change', () => {
        saveSelectedAIs();
      });
    }
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'TAB_STATUS_UPDATE') {
      updateTabStatus(message.aiType, message.connected);
    } else if (message.type === 'RESPONSE_CAPTURED') {
      log(`${message.aiType}: Response captured`, 'success');
      // Update response status
      if (message.content && message.content.trim().length > 0) {
        aiResponseStatus[message.aiType] = true;
      }
      // Handle discussion mode response
      if (discussionState.active && discussionState.pendingResponses.has(message.aiType)) {
        handleDiscussionResponse(message.aiType, message.content);
      }
      // Handle mutual review response
      if (mutualReviewState.active) {
        handleMutualReviewResponse(message.aiType, message.content);
      }
    } else if (message.type === 'SEND_RESULT') {
      if (message.success) {
        log(`${message.aiType}: Message sent`, 'success');
      } else {
        log(`${message.aiType}: Failed - ${message.error}`, 'error');
      }
    }
  });
}

async function checkConnectedTabs() {
  try {
    const tabs = await chrome.tabs.query({});

    // 重置所有连接状态
    const newConnectedState = {
      claude: null,
      chatgpt: null,
      gemini: null,
      chatglm: null,
      aistudio: null
    };

    for (const tab of tabs) {
      const aiType = getAITypeFromUrl(tab.url);
      if (aiType) {
        newConnectedState[aiType] = tab.id;
        connectedTabs[aiType] = tab.id;
        updateTabStatus(aiType, true);
      }
    }

    // 更新未连接的AI状态
    for (const aiType of AI_TYPES) {
      if (!newConnectedState[aiType]) {
        connectedTabs[aiType] = null;
        updateTabStatus(aiType, false);
      }
    }

    // 重新应用可见性设置（只更新显示，不改变默认选中状态）
    applyVisibleAIs(visibleAIsCache, false);
  } catch (err) {
    log('Error checking tabs: ' + err.message, 'error');
  }
}

function getAITypeFromUrl(url) {
  if (!url) return null;
  if (url.includes('claude.ai')) return 'claude';
  if (url.includes('chat.openai.com') || url.includes('chatgpt.com')) return 'chatgpt';
  if (url.includes('gemini.google.com')) return 'gemini';
  if (url.includes('chatglm.cn')) return 'chatglm';
  if (url.includes('aistudio.google.com')) return 'aistudio';
  return null;
}

function updateTabStatus(aiType, connected) {
  const statusEl = document.getElementById(`status-${aiType}`);
  if (statusEl) {
    statusEl.textContent = connected ? 'Connected' : 'Not found';
    statusEl.className = 'status ' + (connected ? 'connected' : 'disconnected');
  }
}

async function handleSend() {
  const message = messageInput.value.trim();
  if (!message) return;

  // Determine targets - always use checkbox selection
  let targets = AI_TYPES.filter(ai => {
    const checkbox = document.getElementById(`target-${ai}`);
    return checkbox && checkbox.checked;
  });

  if (targets.length === 0) {
    log('No targets selected', 'error');
    return;
  }

  sendBtn.disabled = true;

  // Clear input immediately after sending
  messageInput.value = '';

  try {
    // Send to target(s)
    log(`Sending to: ${targets.join(', ')}`);
    for (const target of targets) {
      await sendToAI(target, message);
    }
  } catch (err) {
    log('Error: ' + err.message, 'error');
  }

  sendBtn.disabled = false;
  messageInput.focus();
}

// ============================================
// Mutual Review Functions
// ============================================

// Mutual Review State
let mutualReviewState = {
  active: false,
  speakers: [],           // 被评论的AI列表
  reviewers: [],          // 进行评论的AI列表
  reviewMatrix: {},       // 评论关系矩阵: {reviewer: [speaker1, speaker2, ...]}
  responses: {},          // 发言者的回复内容
  pendingEvaluations: new Set()
};

async function handleMutualReview(speakers, reviewers, reviewMatrix, prompt) {
  // 更新UI状态
  mutualReviewState.active = true;
  mutualReviewState.speakers = speakers;
  mutualReviewState.reviewers = reviewers;
  mutualReviewState.reviewMatrix = reviewMatrix;
  mutualReviewState.responses = {};
  mutualReviewState.pendingEvaluations = new Set();

  updateMutualStatus('fetching', `正在获取发言者的回复...`);
  updateMutualProgress(0, speakers.length);

  // 获取所有发言者的回复
  const responses = {};
  let fetchedCount = 0;

  log(`[Mutual] 获取发言者回复: ${speakers.join(', ')}`);

  for (const ai of speakers) {
    updateMutualStatus('fetching', `正在获取 ${capitalize(ai)} 的回复...`);
    const response = await getLatestResponse(ai);
    if (!response || response.trim().length === 0) {
      updateMutualStatus('error', `${capitalize(ai)} 没有回复，请确保已回复后再互评`);
      log(`[Mutual] 无法获取 ${ai} 的回复 - 请确保 ${ai} 已回复`, 'error');
      mutualReviewState.active = false;
      return;
    }
    responses[ai] = response;
    fetchedCount++;
    updateMutualProgress(fetchedCount, speakers.length);
    log(`[Mutual] 获取到 ${ai} 的回复 (${response.length} 字符)`);
  }

  mutualReviewState.responses = responses;
  updateMutualStatus('sending', `正在发送互评请求...`);
  log(`[Mutual] 所有发言者回复已收集。发送评论请求...`);

  // 为每个评论者发送对应发言者的回复
  let sentCount = 0;
  const totalEvaluations = Object.values(reviewMatrix).reduce((sum, arr) => sum + arr.length, 0);
  updateMutualProgress(0, totalEvaluations);

  for (const reviewer of reviewers) {
    const speakersToReview = reviewMatrix[reviewer] || [];

    if (speakersToReview.length === 0) {
      log(`[Mutual] ${reviewer} 没有需要评论的对象，跳过`);
      continue;
    }

    mutualReviewState.pendingEvaluations.add(reviewer);

    // 构建评论消息
    let evalMessage = `以下是其他 AI 的观点：\n`;

    for (const speaker of speakersToReview) {
      if (responses[speaker]) {
        evalMessage += `
<${speaker}_response>
${responses[speaker]}
</${speaker}_response>
`;
      }
    }

    evalMessage += `\n${prompt}`;

    updateMutualStatus('sending', `正在发送给 ${capitalize(reviewer)}...`);
    log(`[Mutual] 发送给 ${reviewer}: 评论 [${speakersToReview.join(', ')}] 的回复`);
    await sendToAI(reviewer, evalMessage);
    sentCount++;
  }

  updateMutualStatus('waiting', `等待所有评论者完成评价...`);
  updateMutualProgress(0, reviewers.length);
  log(`[Mutual] 完成！已向 ${reviewers.length} 个评论者发送评论请求`, 'success');
}

// 处理互评回复
function handleMutualReviewResponse(aiType, content) {
  if (!mutualReviewState.active) return;
  if (!mutualReviewState.reviewers.includes(aiType)) return;

  mutualReviewState.pendingEvaluations.delete(aiType);

  const remaining = mutualReviewState.pendingEvaluations.size;
  const total = mutualReviewState.reviewers.length;
  const completed = total - remaining;

  updateMutualProgress(completed, total);

  if (remaining === 0) {
    updateMutualStatus('complete', `互评完成！所有 ${total} 个评论者已完成评价`);
    mutualReviewState.active = false;
    setTimeout(() => {
      updateMutualStatus('ready', '准备就绪');
      updateMutualProgress(0, 0);
    }, 3000);
  } else {
    const remainingAIs = Array.from(mutualReviewState.pendingEvaluations).map(capitalize).join(', ');
    updateMutualStatus('waiting', `等待 ${remainingAIs} 完成评价...`);
  }
}

async function getLatestResponse(aiType) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'GET_RESPONSE', aiType },
      (response) => {
        resolve(response?.content || null);
      }
    );
  });
}

async function sendToAI(aiType, message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: 'SEND_MESSAGE', aiType, message },
      (response) => {
        if (response?.success) {
          log(`Sent to ${aiType}`, 'success');
        } else {
          log(`Failed to send to ${aiType}: ${response?.error || 'Unknown error'}`, 'error');
        }
        resolve(response);
      }
    );
  });
}

function log(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = 'log-entry' + (type !== 'info' ? ` ${type}` : '');

  const time = new Date().toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });

  entry.innerHTML = `<span class="time">${time}</span>${message}`;
  logContainer.insertBefore(entry, logContainer.firstChild);

  // Keep only last 50 entries
  while (logContainer.children.length > 50) {
    logContainer.removeChild(logContainer.lastChild);
  }
}

// ============================================
// Discussion Mode Functions
// ============================================

function setupDiscussionMode() {
  // Mode switcher buttons
  document.getElementById('mode-normal').addEventListener('click', () => switchMode('normal'));
  document.getElementById('mode-discussion').addEventListener('click', () => switchMode('discussion'));

  // Discussion controls
  document.getElementById('start-discussion-btn').addEventListener('click', startDiscussion);
  document.getElementById('next-round-btn').addEventListener('click', nextRound);
  document.getElementById('end-discussion-btn').addEventListener('click', endDiscussion);
  document.getElementById('generate-summary-btn').addEventListener('click', generateSummary);
  document.getElementById('new-discussion-btn').addEventListener('click', resetDiscussion);
  document.getElementById('interject-btn').addEventListener('click', handleInterject);

  // Participant selection validation
  document.querySelectorAll('input[name="participant"]').forEach(checkbox => {
    checkbox.addEventListener('change', validateParticipants);
  });
}

function switchMode(mode) {
  const normalMode = document.getElementById('normal-mode');
  const discussionMode = document.getElementById('discussion-mode');
  const normalBtn = document.getElementById('mode-normal');
  const discussionBtn = document.getElementById('mode-discussion');

  if (mode === 'normal') {
    normalMode.classList.remove('hidden');
    discussionMode.classList.add('hidden');
    normalBtn.classList.add('active');
    discussionBtn.classList.remove('active');
  } else {
    normalMode.classList.add('hidden');
    discussionMode.classList.remove('hidden');
    normalBtn.classList.remove('active');
    discussionBtn.classList.add('active');
    
    // 自动选中2个当前连接上的AI
    autoSelectConnectedAIs();
  }
}

async function autoSelectConnectedAIs() {
  // 加载可见AI设置
  try {
    const result = await chrome.storage.local.get(['visibleAIs']);
    if (result.visibleAIs) {
      visibleAIsCache = result.visibleAIs;
    }
  } catch (err) {
    console.error('[AI Panel] Failed to load visible AIs:', err);
  }

  // 获取所有连接的且可见的AI
  const connectedAIs = AI_TYPES.filter(aiType => {
    const isConnected = connectedTabs[aiType];
    const isVisible = visibleAIsCache[aiType] !== false;
    return isConnected && isVisible;
  });
  
  if (connectedAIs.length === 0) {
    // 如果没有连接的AI，取消所有选择
    document.querySelectorAll('input[name="participant"]').forEach(cb => {
      cb.checked = false;
    });
    validateParticipants();
    return;
  }
  
  // 取消所有选择
  document.querySelectorAll('input[name="participant"]').forEach(cb => {
    cb.checked = false;
  });
  
  // 选中前2个连接的AI
  const selectedCount = Math.min(2, connectedAIs.length);
  for (let i = 0; i < selectedCount; i++) {
    const aiType = connectedAIs[i];
    const checkbox = document.querySelector(`input[name="participant"][value="${aiType}"]`);
    if (checkbox) {
      checkbox.checked = true;
    }
  }
  
  // 更新按钮状态
  validateParticipants();
}

function validateParticipants() {
  const selected = document.querySelectorAll('input[name="participant"]:checked');
  const startBtn = document.getElementById('start-discussion-btn');
  startBtn.disabled = selected.length !== 2;
}

async function startDiscussion() {
  const topic = document.getElementById('discussion-topic').value.trim();
  if (!topic) {
    log('请输入讨论主题', 'error');
    return;
  }

  const selected = Array.from(document.querySelectorAll('input[name="participant"]:checked'))
    .map(cb => cb.value);

  if (selected.length !== 2) {
    log('请选择 2 位参与者', 'error');
    return;
  }

  // Initialize discussion state
  discussionState = {
    active: true,
    topic: topic,
    participants: selected,
    currentRound: 1,
    history: [],
    pendingResponses: new Set(selected),
    roundType: 'initial'
  };

  // Update UI
  document.getElementById('discussion-setup').classList.add('hidden');
  document.getElementById('discussion-active').classList.remove('hidden');
  document.getElementById('round-badge').textContent = '第 1 轮';
  document.getElementById('participants-badge').textContent =
    `${capitalize(selected[0])} vs ${capitalize(selected[1])}`;
  document.getElementById('topic-display').textContent = topic;
  updateDiscussionStatus('waiting', `等待 ${selected.join(' 和 ')} 的初始回复...`);

  // Disable buttons during round
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  log(`讨论开始: ${selected.join(' vs ')}`, 'success');

  // Send topic to both AIs
  for (const ai of selected) {
    await sendToAI(ai, `Please share your thoughts on the following topic:\n\n${topic}`);
  }
}

function handleDiscussionResponse(aiType, content) {
  if (!discussionState.active) return;

  // Record this response in history
  discussionState.history.push({
    round: discussionState.currentRound,
    ai: aiType,
    type: discussionState.roundType,
    content: content
  });

  // Remove from pending
  discussionState.pendingResponses.delete(aiType);

  log(`讨论: ${aiType} 已回复 (第 ${discussionState.currentRound} 轮)`, 'success');

  // Check if all pending responses received
  if (discussionState.pendingResponses.size === 0) {
    onRoundComplete();
  } else {
    const remaining = Array.from(discussionState.pendingResponses).join(', ');
    updateDiscussionStatus('waiting', `等待 ${remaining}...`);
  }
}

function onRoundComplete() {
  log(`第 ${discussionState.currentRound} 轮完成`, 'success');
  updateDiscussionStatus('ready', `第 ${discussionState.currentRound} 轮完成，可以进入下一轮`);

  // Enable next round button
  document.getElementById('next-round-btn').disabled = false;
  document.getElementById('generate-summary-btn').disabled = false;
}

async function nextRound() {
  discussionState.currentRound++;
  const [ai1, ai2] = discussionState.participants;

  // Update UI
  document.getElementById('round-badge').textContent = `第 ${discussionState.currentRound} 轮`;
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  // Get previous round responses
  const prevRound = discussionState.currentRound - 1;
  const ai1Response = discussionState.history.find(
    h => h.round === prevRound && h.ai === ai1
  )?.content;
  const ai2Response = discussionState.history.find(
    h => h.round === prevRound && h.ai === ai2
  )?.content;

  if (!ai1Response || !ai2Response) {
    log('缺少上一轮的回复', 'error');
    return;
  }

  // Set pending responses
  discussionState.pendingResponses = new Set([ai1, ai2]);
  discussionState.roundType = 'cross-eval';

  updateDiscussionStatus('waiting', `交叉评价: ${ai1} 评价 ${ai2}，${ai2} 评价 ${ai1}...`);

  log(`第 ${discussionState.currentRound} 轮: 交叉评价开始`);

  // Send cross-evaluation requests
  // AI1 evaluates AI2's response
  const msg1 = `Here is ${capitalize(ai2)}'s response to the topic "${discussionState.topic}":

<${ai2}_response>
${ai2Response}
</${ai2}_response>

Please evaluate this response. What do you agree with? What do you disagree with? What would you add or change?`;

  // AI2 evaluates AI1's response
  const msg2 = `Here is ${capitalize(ai1)}'s response to the topic "${discussionState.topic}":

<${ai1}_response>
${ai1Response}
</${ai1}_response>

Please evaluate this response. What do you agree with? What do you disagree with? What would you add or change?`;

  await sendToAI(ai1, msg1);
  await sendToAI(ai2, msg2);
}

async function handleInterject() {
  const input = document.getElementById('interject-input');
  const message = input.value.trim();

  if (!message) {
    log('请输入要发送的消息', 'error');
    return;
  }

  if (!discussionState.active || discussionState.participants.length === 0) {
    log('当前没有进行中的讨论', 'error');
    return;
  }

  const btn = document.getElementById('interject-btn');
  btn.disabled = true;

  const [ai1, ai2] = discussionState.participants;

  log(`[插话] 正在获取双方最新回复...`);

  // Get latest responses from both participants
  const ai1Response = await getLatestResponse(ai1);
  const ai2Response = await getLatestResponse(ai2);

  if (!ai1Response || !ai2Response) {
    log(`[插话] 无法获取回复，请确保双方都已回复`, 'error');
    btn.disabled = false;
    return;
  }

  log(`[插话] 已获取双方回复，正在发送...`);

  // Send to AI1: user message + AI2's response
  const msg1 = `${message}

以下是 ${capitalize(ai2)} 的最新回复：

<${ai2}_response>
${ai2Response}
</${ai2}_response>`;

  // Send to AI2: user message + AI1's response
  const msg2 = `${message}

以下是 ${capitalize(ai1)} 的最新回复：

<${ai1}_response>
${ai1Response}
</${ai1}_response>`;

  await sendToAI(ai1, msg1);
  await sendToAI(ai2, msg2);

  log(`[插话] 已发送给双方（含对方回复）`, 'success');

  // Clear input
  input.value = '';
  btn.disabled = false;
}

async function generateSummary() {
  document.getElementById('generate-summary-btn').disabled = true;
  updateDiscussionStatus('waiting', '正在请求双方生成总结...');

  const [ai1, ai2] = discussionState.participants;

  // Build conversation history for summary
  let historyText = `主题: ${discussionState.topic}\n\n`;

  for (let round = 1; round <= discussionState.currentRound; round++) {
    historyText += `=== 第 ${round} 轮 ===\n\n`;
    const roundEntries = discussionState.history.filter(h => h.round === round);
    for (const entry of roundEntries) {
      historyText += `[${capitalize(entry.ai)}]:\n${entry.content}\n\n`;
    }
  }

  const summaryPrompt = `请对以下 AI 之间的讨论进行总结。请包含：
1. 主要共识点
2. 主要分歧点
3. 各方的核心观点
4. 总体结论

讨论历史：
${historyText}`;

  // Send to both AIs
  discussionState.roundType = 'summary';
  discussionState.pendingResponses = new Set([ai1, ai2]);

  log(`[Summary] 正在请求双方生成总结...`);
  await sendToAI(ai1, summaryPrompt);
  await sendToAI(ai2, summaryPrompt);

  // Wait for both responses, then show summary
  const checkForSummary = setInterval(async () => {
    if (discussionState.pendingResponses.size === 0) {
      clearInterval(checkForSummary);

      // Get both summaries
      const summaries = discussionState.history.filter(h => h.type === 'summary');
      const ai1Summary = summaries.find(s => s.ai === ai1)?.content || '';
      const ai2Summary = summaries.find(s => s.ai === ai2)?.content || '';

      log(`[Summary] 双方总结已生成`, 'success');
      showSummary(ai1Summary, ai2Summary);
    }
  }, 500);
}

function showSummary(ai1Summary, ai2Summary) {
  document.getElementById('discussion-active').classList.add('hidden');
  document.getElementById('discussion-summary').classList.remove('hidden');

  const [ai1, ai2] = discussionState.participants;

  // Handle empty summaries
  if (!ai1Summary && !ai2Summary) {
    log('警告: 未收到 AI 的总结内容', 'error');
  }

  // Build summary HTML - show both summaries side by side conceptually
  let html = `<div class="round-summary">
    <h4>双方总结对比</h4>
    <div class="summary-comparison">
      <div class="ai-response">
        <div class="ai-name ${ai1}">${capitalize(ai1)} 的总结：</div>
        <div>${escapeHtml(ai1Summary).replace(/\n/g, '<br>')}</div>
      </div>
      <div class="ai-response">
        <div class="ai-name ${ai2}">${capitalize(ai2)} 的总结：</div>
        <div>${escapeHtml(ai2Summary).replace(/\n/g, '<br>')}</div>
      </div>
    </div>
  </div>`;

  // Add round-by-round history
  html += `<div class="round-summary"><h4>完整讨论历史</h4>`;
  for (let round = 1; round <= discussionState.currentRound; round++) {
    const roundEntries = discussionState.history.filter(h => h.round === round && h.type !== 'summary');
    if (roundEntries.length > 0) {
      html += `<div style="margin-top:12px"><strong>第 ${round} 轮</strong></div>`;
      for (const entry of roundEntries) {
        const preview = entry.content.substring(0, 200) + (entry.content.length > 200 ? '...' : '');
        html += `<div class="ai-response">
          <div class="ai-name ${entry.ai}">${capitalize(entry.ai)}:</div>
          <div>${escapeHtml(preview).replace(/\n/g, '<br>')}</div>
        </div>`;
      }
    }
  }
  html += `</div>`;

  document.getElementById('summary-content').innerHTML = html;
  discussionState.active = false;
  log('讨论总结已生成', 'success');
}

function endDiscussion() {
  if (confirm('确定结束讨论吗？建议先生成总结。')) {
    resetDiscussion();
  }
}

function resetDiscussion() {
  discussionState = {
    active: false,
    topic: '',
    participants: [],
    currentRound: 0,
    history: [],
    pendingResponses: new Set(),
    roundType: null
  };

  // Reset UI
  document.getElementById('discussion-setup').classList.remove('hidden');
  document.getElementById('discussion-active').classList.add('hidden');
  document.getElementById('discussion-summary').classList.add('hidden');
  document.getElementById('discussion-topic').value = '';
  document.getElementById('next-round-btn').disabled = true;
  document.getElementById('generate-summary-btn').disabled = true;

  log('讨论已结束');
}

function updateDiscussionStatus(state, text) {
  const statusEl = document.getElementById('discussion-status');
  statusEl.textContent = text;
  statusEl.className = 'discussion-status ' + state;
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// Save and Restore Selected AIs
// ============================================

function saveSelectedAIs() {
  const selected = {};
  AI_TYPES.forEach(aiType => {
    const checkbox = document.getElementById(`target-${aiType}`);
    // 只保存已连接AI的选中状态
    if (checkbox && connectedTabs[aiType]) {
      selected[aiType] = checkbox.checked;
    }
  });

  chrome.storage.local.set({ selectedAIs: selected }, () => {
    if (chrome.runtime.lastError) {
      console.error('[AI Panel] Failed to save selected AIs:', chrome.runtime.lastError);
    }
  });
}

async function restoreSelectedAIs() {
  try {
    const result = await chrome.storage.local.get(['selectedAIs']);
    if (result.selectedAIs) {
      AI_TYPES.forEach(aiType => {
        // 只恢复已连接AI的选中状态
        if (connectedTabs[aiType]) {
          const checkbox = document.getElementById(`target-${aiType}`);
          if (checkbox && result.selectedAIs.hasOwnProperty(aiType)) {
            checkbox.checked = result.selectedAIs[aiType];
          }
        }
      });
    }
  } catch (err) {
    console.error('[AI Panel] Failed to restore selected AIs:', err);
  }
}

// ============================================
// Settings Functions
// ============================================

function setupSettings() {
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsClose = document.getElementById('settings-close');
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  const settingsOverlay = document.querySelector('.settings-overlay');

  // Open settings
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    loadVisibleAIsToSettings();
  });

  // Close settings
  settingsClose.addEventListener('click', closeSettings);
  settingsOverlay.addEventListener('click', closeSettings);

  // Save settings
  settingsSaveBtn.addEventListener('click', saveVisibleAIs);

  // Close on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
      closeSettings();
    }
  });
}

function closeSettings() {
  document.getElementById('settings-modal').classList.add('hidden');
}

async function loadVisibleAIsToSettings() {
  try {
    const result = await chrome.storage.local.get(['visibleAIs']);
    const visibleAIs = result.visibleAIs || {
      claude: true,
      chatgpt: true,
      gemini: true,
      chatglm: true,
      aistudio: true
    };

    // Update checkboxes in settings
    AI_TYPES.forEach(aiType => {
      const checkbox = document.querySelector(`input[name="visible-ai"][value="${aiType}"]`);
      if (checkbox) {
        checkbox.checked = visibleAIs[aiType] !== false; // Default to true if not set
      }
    });
  } catch (err) {
    console.error('[AI Panel] Failed to load visible AIs:', err);
  }
}

async function saveVisibleAIs() {
  try {
    const visibleAIs = {};
    const checkboxes = document.querySelectorAll('input[name="visible-ai"]');
    
    checkboxes.forEach(checkbox => {
      visibleAIs[checkbox.value] = checkbox.checked;
    });

    // Ensure at least one AI is visible
    const hasVisible = Object.values(visibleAIs).some(v => v);
    if (!hasVisible) {
      log('至少需要显示一个 AI', 'error');
      return;
    }

    await chrome.storage.local.set({ visibleAIs });
    visibleAIsCache = visibleAIs;
    log('设置已保存', 'success');
    
    // Apply settings immediately
    applyVisibleAIs(visibleAIs, true);

    // Close settings modal
    closeSettings();
  } catch (err) {
    console.error('[AI Panel] Failed to save visible AIs:', err);
    log('保存设置失败: ' + err.message, 'error');
  }
}

async function loadAndApplyVisibleAIs() {
  try {
    const result = await chrome.storage.local.get(['visibleAIs']);
    const visibleAIs = result.visibleAIs || {
      claude: true,
      chatgpt: true,
      gemini: true,
      chatglm: true,
      aistudio: true
    };
    visibleAIsCache = visibleAIs;
    applyVisibleAIs(visibleAIs, true); // 首次加载时设置默认选中状态
  } catch (err) {
    console.error('[AI Panel] Failed to load visible AIs:', err);
  }
}

function applyVisibleAIs(visibleAIs, setDefaults = false) {
  AI_TYPES.forEach(aiType => {
    const isConnected = connectedTabs[aiType] !== null;
    const isEnabled = visibleAIs[aiType] !== false; // Default to true if not set

    // 普通模式：显示所有已连接的AI
    const checkbox = document.getElementById(`target-${aiType}`);
    if (checkbox) {
      const targetLabel = checkbox.closest('.target-label');
      if (targetLabel) {
        // 只显示已连接的AI
        targetLabel.style.display = isConnected ? '' : 'none';
        // 首次加载时，默认选中配置中启用的AI
        if (setDefaults && isConnected && isEnabled && !checkbox.checked) {
          checkbox.checked = true;
        }
      }
    }

    // 讨论模式：只显示已连接的AI
    const participantOption = document.querySelector(`input[name="participant"][value="${aiType}"]`);
    if (participantOption) {
      const participantLabel = participantOption.closest('.participant-option');
      if (participantLabel) {
        participantLabel.style.display = isConnected ? '' : 'none';
      }
    }

    // 互评模式：只显示已连接的AI
    const speakerCheckbox = document.querySelector(`#speaker-checkboxes input[value="${aiType}"]`);
    if (speakerCheckbox) {
      const roleCheckbox = speakerCheckbox.closest('.role-checkbox');
      if (roleCheckbox) {
        roleCheckbox.style.display = isConnected ? '' : 'none';
      }
    }

    const reviewerCheckbox = document.querySelector(`#reviewer-checkboxes input[value="${aiType}"]`);
    if (reviewerCheckbox) {
      const roleCheckbox = reviewerCheckbox.closest('.role-checkbox');
      if (roleCheckbox) {
        roleCheckbox.style.display = isConnected ? '' : 'none';
      }
    }

    // 如果AI未连接，取消选中
    if (!isConnected) {
      if (checkbox && checkbox.checked) {
        checkbox.checked = false;
        saveSelectedAIs();
      }

      if (participantOption && participantOption.checked) {
        participantOption.checked = false;
        validateParticipants();
      }

      if (speakerCheckbox && speakerCheckbox.checked) {
        speakerCheckbox.checked = false;
      }

      if (reviewerCheckbox && reviewerCheckbox.checked) {
        reviewerCheckbox.checked = false;
      }
    }
  });

  // 更新互评UI
  updateMutualUI();
}

// ============================================
// Connection Refresh
// ============================================

let connectionRefreshInterval = null;

function startConnectionRefresh() {
  // 立即检查一次
  checkConnectedTabs();
  
  // 每3秒刷新一次连接状态
  connectionRefreshInterval = setInterval(() => {
    checkConnectedTabs();
  }, 3000);
  
  // 当页面可见性变化时也检查（用户切换回标签页时）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      checkConnectedTabs();
    }
  });
}

// ============================================
// Mutual Review UI Functions
// ============================================

function setupMutualReview() {
  const toggleBtn = document.getElementById('mutual-toggle-btn');
  const header = document.querySelector('.mutual-review-header');
  const content = document.getElementById('mutual-review-content');
  const startBtn = document.getElementById('mutual-start-btn');

  // 切换展开/收起
  const toggleMutualPanel = () => {
    const isExpanded = !content.classList.contains('hidden');
    if (isExpanded) {
      content.classList.add('hidden');
      toggleBtn.textContent = '▼';
      toggleBtn.classList.remove('expanded');
    } else {
      content.classList.remove('hidden');
      toggleBtn.textContent = '▲';
      toggleBtn.classList.add('expanded');
      updateMutualUI();
    }
  };

  toggleBtn.addEventListener('click', toggleMutualPanel);
  if (header) {
    header.addEventListener('click', (e) => {
      if (e.target !== toggleBtn && !toggleBtn.contains(e.target)) {
        toggleMutualPanel();
      }
    });
  }

  // 角色选择复选框事件
  setupRoleCheckboxListeners();

  // 开始互评按钮
  startBtn.addEventListener('click', async () => {
    await startMutualReview();
  });

  // 初始更新
  updateMutualUI();
}

// 设置角色复选框监听器
function setupRoleCheckboxListeners() {
  const speakerCheckboxes = document.querySelectorAll('#speaker-checkboxes input[type="checkbox"]');
  const reviewerCheckboxes = document.querySelectorAll('#reviewer-checkboxes input[type="checkbox"]');

  [...speakerCheckboxes, ...reviewerCheckboxes].forEach(checkbox => {
    checkbox.addEventListener('change', () => {
      updateMutualUI();
    });
  });
}

// 设置视图切换监听器
// 更新互评UI
async function updateMutualUI() {
  const speakers = getSelectedSpeakers();
  const reviewers = getSelectedReviewers();

  updateStartButtonState(speakers, reviewers);

  // 检查发言者的回复状态
  if (speakers.length > 0) {
    await checkResponseStatus(speakers);
  }
}

// 获取选中的发言者
function getSelectedSpeakers() {
  const checkboxes = document.querySelectorAll('#speaker-checkboxes input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

// 更新开始按钮状态
function updateStartButtonState(speakers, reviewers) {
  const startBtn = document.getElementById('mutual-start-btn');

  if (speakers.length === 0 || reviewers.length === 0) {
    startBtn.disabled = true;
    updateMutualStatus('ready', '请选择发言者和评论者');
    return;
  }

  // 检查发言者是否都有回复
  const missingResponses = speakers.filter(ai => !aiResponseStatus[ai]);
  if (missingResponses.length > 0) {
    startBtn.disabled = true;
    updateMutualStatus('warning', `以下发言者还没有回复：${missingResponses.map(capitalize).join(', ')}`);
    return;
  }

  startBtn.disabled = false;
  updateMutualStatus('ready', '准备就绪，可以开始互评');
}

// 开始互评
async function startMutualReview() {
  const speakers = getSelectedSpeakers();
  const reviewers = getSelectedReviewers();

  if (speakers.length === 0 || reviewers.length === 0) {
    updateMutualStatus('error', '请先选择发言者和评论者');
    return;
  }

  // 构建评论关系矩阵：默认使用"评论者→发言者"配置（排除自己）
  const reviewMatrix = {};
  reviewers.forEach(reviewer => {
    reviewMatrix[reviewer] = speakers.filter(s => s !== reviewer);
  });

  // 检查是否有有效的评论关系
  const hasValidRelations = Object.values(reviewMatrix).some(targets => targets.length > 0);
  if (!hasValidRelations) {
    updateMutualStatus('error', '请配置至少一个评论关系');
    return;
  }

  // 获取提示词
  const promptInput = document.getElementById('mutual-prompt-input');
  const customPrompt = promptInput.value.trim();
  const prompt = customPrompt || '请评价以上观点。你同意什么？不同意什么？有什么补充？';

  const startBtn = document.getElementById('mutual-start-btn');
  startBtn.disabled = true;
  updateMutualStatus('processing', '正在执行互评...');

  try {
    await handleMutualReview(speakers, reviewers, reviewMatrix, prompt);
    updateMutualStatus('complete', '互评完成！');
  } catch (err) {
    updateMutualStatus('error', '互评失败：' + err.message);
    log(`[Mutual] 错误：${err.message}`, 'error');
  } finally {
    startBtn.disabled = false;
  }
}

// 更新状态文本
function updateMutualStatus(state, text) {
  const statusText = document.getElementById('mutual-status-text');
  if (!statusText) return;

  statusText.textContent = text;
  statusText.className = 'mutual-status-text';

  const statusContainer = document.getElementById('mutual-status');
  if (statusContainer) {
    statusContainer.className = 'mutual-status status-' + state;
  }
}

// 检查回复状态
async function checkResponseStatus(aiTypes) {
  for (const aiType of aiTypes) {
    try {
      const response = await getLatestResponse(aiType);
      aiResponseStatus[aiType] = !!(response && response.trim().length > 0);
    } catch (err) {
      aiResponseStatus[aiType] = false;
    }
  }
}

// 更新进度（简化版本，不需要进度条元素）
function updateMutualProgress(current, total) {
  // 如果需要显示进度，可以在状态文本中添加
  if (total > 0) {
    const percentage = Math.round((current / total) * 100);
    // 可以在状态文本中添加进度信息
  }
}

// ============================================
// Build Time Display
// ============================================

async function displayBuildTime() {
  try {
    // Read build_time from build-info.json
    const buildInfoUrl = chrome.runtime.getURL('build-info.json');
    const response = await fetch(buildInfoUrl);

    if (response.ok) {
      const buildInfo = await response.json();
      const buildTime = buildInfo.build_time;

      if (buildTime) {
        // Format the time for display
        const buildDate = new Date(buildTime);
        const formattedTime = buildDate.toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        });

        const buildTimeEl = document.getElementById('build-time');
        if (buildTimeEl) {
          buildTimeEl.textContent = formattedTime;
        }
      } else {
        // Fallback if build_time is not set
        const buildTimeEl = document.getElementById('build-time');
        if (buildTimeEl) {
          buildTimeEl.textContent = '未知';
        }
      }
    } else {
      throw new Error('Failed to load build-info.json');
    }
  } catch (err) {
    console.error('[AI Panel] Failed to display build time:', err);
    const buildTimeEl = document.getElementById('build-time');
    if (buildTimeEl) {
      buildTimeEl.textContent = '加载失败';
    }
  }
}

// ============================================
// Move Tabs to New Window
// ============================================

async function moveTabsToNewWindow() {
  try {
    // 获取所有选中且已连接的AI标签ID
    const selectedTabIds = [];
    const selectedAINames = [];

    for (const aiType of AI_TYPES) {
      const checkbox = document.getElementById(`target-${aiType}`);
      if (checkbox && checkbox.checked && connectedTabs[aiType]) {
        selectedTabIds.push(connectedTabs[aiType]);
        selectedAINames.push(capitalize(aiType));
      }
    }

    if (selectedTabIds.length === 0) {
      log('没有选中的已连接AI标签', 'error');
      return;
    }

    log(`正在移动 ${selectedAINames.join(', ')} 到新窗口...`);

    // 创建新窗口
    const newWindow = await chrome.windows.create({
      url: 'about:blank',
      focused: true
    });

    // 移动AI标签到新窗口
    await chrome.tabs.move(selectedTabIds, {
      windowId: newWindow.id,
      index: -1
    });

    // 关闭新窗口创建时的空白标签
    const tabs = await chrome.tabs.query({ windowId: newWindow.id });
    const blankTab = tabs.find(tab => tab.url === 'about:blank' || tab.url === chrome.runtime.getURL('about:blank'));
    if (blankTab) {
      await chrome.tabs.remove(blankTab.id);
    }

    // 设置侧边栏在新窗口中启用
    if (chrome.sidePanel && chrome.sidePanel.setOptions) {
      try {
        await chrome.sidePanel.setOptions({
          windowId: newWindow.id,
          enabled: true
        });
      } catch (err) {
        console.warn('[Move Tabs] Could not set sidePanel options:', err);
      }
    }

    // 通过 background.js 打开新窗口的侧边栏
    try {
      await chrome.runtime.sendMessage({
        type: 'OPEN_SIDE_PANEL_IN_WINDOW',
        windowId: newWindow.id
      });
    } catch (err) {
      console.warn('[Move Tabs] Could not open side panel via background:', err);
    }

    log(`已将 ${selectedAINames.length} 个AI标签移动到新窗口`, 'success');

    // 提示用户
    setTimeout(() => {
      log('侧边栏应该已在新窗口中自动打开', 'info');
    }, 1000);

  } catch (err) {
    log('移动标签失败: ' + err.message, 'error');
    console.error('[Move Tabs] Error:', err);
  }
}
