/**
 * Lets Chat - Vanilla JS Client Application
 * Two-stage Permanent Code -> Temporary Token Architecture
 */

(() => {
  // DOM Elements
  const myPermanentCodeEl = document.getElementById("my-permanent-code");
  const copyCodeBtn = document.getElementById("copy-code-btn");
  const copyBtnLabel = document.getElementById("copy-btn-label");
  const targetCodeInput = document.getElementById("target-code-input");
  const pairForm = document.getElementById("pair-form");
  const connectBtn = document.getElementById("connect-btn");
  const pairError = document.getElementById("pair-error");

  const socketStatusText = document.getElementById("socket-status-text");
  const socketIndicator = document.getElementById("socket-indicator");

  const sessionCard = document.getElementById("session-card");
  const sessionBadge = document.getElementById("session-badge");
  const connectedPartnerLabel = document.getElementById("connected-partner-label");
  const myTempTokenEl = document.getElementById("my-temp-token");
  const partnerTempTokenEl = document.getElementById("partner-temp-token");
  const handshakeActionContainer = document.getElementById("handshake-action-container");
  const manualHandshakeBtn = document.getElementById("manual-handshake-btn");
  const disconnectBtn = document.getElementById("disconnect-btn");
  const headerDisconnectBtn = document.getElementById("header-disconnect-btn");

  const chatPartnerName = document.getElementById("chat-partner-name");
  const chatPartnerCode = document.getElementById("chat-partner-code");
  const partnerAvatar = document.getElementById("partner-avatar");
  const chatStatusIndicator = document.getElementById("chat-status-indicator");
  const chatStatusText = document.getElementById("chat-status-text");

  const introTimerBadge = document.getElementById("intro-timer-badge");
  const introCountdown = document.getElementById("intro-countdown");
  const introBanner = document.getElementById("intro-banner");
  const introHandshakeActionBtn = document.getElementById("intro-handshake-action-btn");

  const privateModeBadge = document.getElementById("private-mode-badge");
  const privateBanner = document.getElementById("private-banner");
  const leavePrivateBtn = document.getElementById("leave-private-btn");
  const leavePrivateBannerBtn = document.getElementById("leave-private-banner-btn");

  const emptyChatState = document.getElementById("empty-chat-state");
  const emptyCodePreview = document.getElementById("empty-code-preview");
  const emptyCopyBtn = document.getElementById("empty-copy-btn");
  const messagesList = document.getElementById("messages-list");
  const messagesContainer = document.getElementById("messages-container");
  const typingIndicator = document.getElementById("typing-indicator");

  const replyPreviewBar = document.getElementById("reply-preview-bar");
  const replyAuthor = document.getElementById("reply-author");
  const replySnippet = document.getElementById("reply-snippet");
  const cancelReplyBtn = document.getElementById("cancel-reply-btn");

  const composerForm = document.getElementById("composer-form");
  const messageInput = document.getElementById("message-input");
  const sendBtn = document.getElementById("send-btn");

  const emojiToggleBtn = document.getElementById("emoji-toggle-btn");
  const emojiPickerDropdown = document.getElementById("emoji-picker-dropdown");
  const emojiGrid = document.getElementById("emoji-grid");

  const privateModal = document.getElementById("private-modal");
  const privateModalRequester = document.getElementById("private-modal-requester");
  const privateAcceptBtn = document.getElementById("private-accept-btn");
  const privateDeclineBtn = document.getElementById("private-decline-btn");

  const privateWaitingModal = document.getElementById("private-waiting-modal");
  const cancelPrivateRequestBtn = document.getElementById("cancel-private-request-btn");

  const toastContainer = document.getElementById("toast-container");
  const appContainer = document.getElementById("app-container");
  const sidebar = document.getElementById("sidebar");
  const collapseSidebarBtn = document.getElementById("collapse-sidebar-btn");
  const toggleSidebarBtn = document.getElementById("toggle-sidebar-btn") || document.getElementById("open-sidebar-btn");
  const openSidebarBtn = document.getElementById("open-sidebar-btn");
  const closeSidebarBtn = document.getElementById("close-sidebar-btn");

  // Profile Card & Display Name Elements
  const profileCard = document.getElementById("profile-card");
  const profilePreviewRow = document.getElementById("profile-preview-row");
  const myAvatarPreview = document.getElementById("my-avatar-preview");
  const myDisplayNameText = document.getElementById("my-display-name-text");
  const editNameBtn = document.getElementById("edit-name-btn");
  const displayNameForm = document.getElementById("display-name-form");
  const displayNameInput = document.getElementById("display-name-input");
  const saveNameBtn = document.getElementById("save-name-btn");
  const cancelNameBtn = document.getElementById("cancel-name-btn");

  // Application State
  const state = {
    userId: null,
    permanentCode: null,
    recoveryKey: null,
    displayName: localStorage.getItem("letschat_display_name") || null,
    partnerDisplayName: null,
    sidebarCollapsed: false,
    connectionState: "OFFLINE", // OFFLINE, WAITING, TEMPORARY_INTRO, FULLY_CONNECTED
    chatMode: "NORMAL", // NORMAL, PRIVATE
    partnerCode: null,
    myTempToken: null,
    partnerTempToken: null,
    introductionId: null,
    handshakeSent: false,
    partnerTokenReceived: false,
    partnerVerified: false,
    pendingPrivateRequestId: null,
    introExpiresAt: null,
    countdownInterval: null,
    typingTimer: null,
    activeReply: null, // { id, text, author }
    theme: localStorage.getItem("letschat_theme") || "dark",
    soundEnabled: localStorage.getItem("letschat_sound_enabled") !== "false"
  };

  // Sound chime helper using Web Audio API
  function playNotificationChime(force = false) {
    if (!state.soundEnabled && !force) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch (e) {
      // Audio context may be restricted before user gesture
    }
  }

  // Toast Notification
  function showToast(message, type = "info") {
    const toast = document.createElement("div");
    toast.className = `toast ${type === "error" ? "toast-error" : type === "success" ? "toast-success" : ""}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  // Socket.IO Setup
  const socket = io({
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  socket.on("connect", () => {
    socketIndicator.className = "status-indicator connected";
    socketStatusText.textContent = "Connected to server";

    // Recover or initialize identity from localStorage
    const savedCode = localStorage.getItem("tokenchat_permanent_code");
    const savedKey = localStorage.getItem("tokenchat_recovery_key");
    const savedName = localStorage.getItem("letschat_display_name");

    socket.emit("register-session", {
      permanentCode: savedCode || undefined,
      recoveryKey: savedKey || undefined,
      displayName: savedName || undefined
    });
  });

  socket.on("disconnect", () => {
    socketIndicator.className = "status-indicator offline";
    socketStatusText.textContent = "Disconnected from server";
    updateConnectionUI("OFFLINE");
  });

  socket.on("connect_error", () => {
    socketIndicator.className = "status-indicator offline";
    socketStatusText.textContent = "Connection error";
  });

  // Session Registered (Permanent Identity)
  socket.on("session-registered", (data) => {
    state.userId = data.userId;
    state.permanentCode = data.permanentCode;
    state.recoveryKey = data.recoveryKey;
    if (data.displayName) {
      state.displayName = data.displayName;
      localStorage.setItem("letschat_display_name", data.displayName);
    }
    updateProfileUI();

    // Persist identity in localStorage
    localStorage.setItem("tokenchat_permanent_code", data.permanentCode);
    localStorage.setItem("tokenchat_recovery_key", data.recoveryKey);

    // Update UI elements
    myPermanentCodeEl.textContent = data.permanentCode;
    emptyCodePreview.textContent = data.permanentCode;

    if (state.connectionState === "OFFLINE") {
      updateConnectionUI("WAITING");
    }

    if (data.isNew) {
      showToast("Welcome! Your unique Permanent Code has been generated.", "success");
    }
  });

  // Copy Code Button Handlers
  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        copyBtnLabel.textContent = "Copied!";
        showToast("Permanent code copied to clipboard!", "success");
        setTimeout(() => {
          copyBtnLabel.textContent = "Copy";
        }, 2000);
      }).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const input = document.createElement("input");
    input.value = text;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
    copyBtnLabel.textContent = "Copied!";
    showToast("Permanent code copied to clipboard!", "success");
    setTimeout(() => {
      copyBtnLabel.textContent = "Copy";
    }, 2000);
  }

  copyCodeBtn.addEventListener("click", () => {
    if (state.permanentCode) copyToClipboard(state.permanentCode);
  });

  emptyCopyBtn.addEventListener("click", () => {
    if (state.permanentCode) copyToClipboard(state.permanentCode);
  });

  // Pairing Submission
  pairForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const raw = targetCodeInput.value.trim().toUpperCase();
    if (!raw) {
      showPairError("Please enter a permanent code.");
      return;
    }
    if (raw === state.permanentCode) {
      showPairError("You cannot connect to your own code.");
      return;
    }

    hidePairError();
    connectBtn.disabled = true;
    connectBtn.textContent = "Connecting...";

    socket.emit("pair-with-permanent-code", { targetCode: raw });
  });

  function showPairError(msg) {
    pairError.textContent = msg;
    pairError.classList.remove("hidden");
    showToast(msg, "error");
    connectBtn.disabled = false;
    connectBtn.textContent = "Connect";
  }

  function hidePairError() {
    pairError.classList.add("hidden");
    pairError.textContent = "";
  }

  socket.on("pairing-failed", (data) => {
    showPairError(data.message || "Pairing failed.");
  });

  // STAGE 1 -> 2: Temporary Introduction Connection Started
  socket.on("introduction-start", (data) => {
    connectBtn.disabled = false;
    connectBtn.textContent = "Connect";
    targetCodeInput.value = "";
    hidePairError();

    state.partnerCode = data.partnerCode;
    state.partnerDisplayName = data.partnerDisplayName || null;
    state.myTempToken = data.myTemporaryToken;
    state.partnerTempToken = data.partnerTemporaryToken;
    state.introductionId = data.introductionId;
    state.introExpiresAt = data.expiresAt;
    state.handshakeSent = false;
    state.partnerTokenReceived = !!data.partnerTemporaryToken;
    state.partnerVerified = false;

    manualHandshakeBtn.disabled = false;
    manualHandshakeBtn.textContent = "🔗 Verify Handshake & Connect Full";
    if (introHandshakeActionBtn) {
      introHandshakeActionBtn.disabled = false;
      introHandshakeActionBtn.textContent = "🔗 Verify Handshake & Connect Full";
    }

    updateConnectionUI("TEMPORARY_INTRO");
    startIntroCountdown(data.expiresAt);

    // Close sidebar on mobile
    sidebar.classList.remove("open");

    showToast("🟡 Temporary connection established! (90-sec verification)", "info");
    playNotificationChime();
  });

  // Partner Updated Display Name Live
  socket.on("partner-name-updated", (data) => {
    state.partnerDisplayName = data.partnerDisplayName || null;
    updatePartnerHeaderUI();
    const name = data.partnerDisplayName || "Stranger";
    showToast(`Partner is now known as: ${name}`, "info");
  });

  // Countdown Timer for Temporary Intro
  function startIntroCountdown(expiresAt) {
    if (state.countdownInterval) clearInterval(state.countdownInterval);

    function update() {
      const now = Date.now();
      const diff = Math.max(0, Math.floor((expiresAt - now) / 1000));
      const mins = Math.floor(diff / 60).toString().padStart(2, "0");
      const secs = (diff % 60).toString().padStart(2, "0");
      introCountdown.textContent = `${mins}:${secs}`;

      if (diff <= 0) {
        clearInterval(state.countdownInterval);
        state.countdownInterval = null;
      }
    }

    update();
    state.countdownInterval = setInterval(update, 1000);
  }

  // Temporary Intro Expired
  socket.on("introduction-expired", (data) => {
    if (state.countdownInterval) clearInterval(state.countdownInterval);
    state.countdownInterval = null;
    state.handshakeSent = false;
    state.partnerTokenReceived = false;
    state.partnerVerified = false;

    showToast(data.message || "The temporary connection expired.", "error");
    updateConnectionUI("WAITING");
  });

  // Token Exchange Events over Temporary Connection
  socket.on("partner-token-exchanged", (data) => {
    if (data.introductionId === state.introductionId) {
      state.partnerTempToken = data.partnerTemporaryToken;
      state.partnerTokenReceived = true;
      if (partnerTempTokenEl) {
        partnerTempTokenEl.textContent = data.partnerTemporaryToken;
      }
      showToast("Partner credential received over temporary connection!", "info");

      // If user had already initiated handshake verification, submit partner token to cross-verify
      if (state.handshakeSent && !state.partnerVerified) {
        socket.emit("complete-handshake", {
          introductionId: state.introductionId,
          token: state.myTempToken,
          partnerToken: data.partnerTemporaryToken
        });
      }
    }
  });

  socket.on("token-committed", (data) => {
    if (data.partnerTemporaryToken) {
      state.partnerTempToken = data.partnerTemporaryToken;
      state.partnerTokenReceived = true;
      if (partnerTempTokenEl) {
        partnerTempTokenEl.textContent = data.partnerTemporaryToken;
      }
    }
  });

  // Partner token successfully verified by server (Stage 2 sub-step)
  socket.on("partner-token-verified", (data) => {
    state.partnerVerified = true;
    manualHandshakeBtn.disabled = true;
    manualHandshakeBtn.textContent = "Partner Verified — Waiting for Mutual Verification...";
    if (introHandshakeActionBtn) {
      introHandshakeActionBtn.disabled = true;
      introHandshakeActionBtn.textContent = "Partner Verified — Waiting for Mutual Verification...";
    }
    showToast("Partner token verified! Waiting for partner to verify yours...", "info");
  });

  // STAGE 2 -> 3: Handshake Confirmation / Full Live Connection
  function completeHandshake() {
    if (!state.myTempToken || !state.introductionId) return;
    state.handshakeSent = true;
    manualHandshakeBtn.disabled = true;
    manualHandshakeBtn.textContent = "Exchanging Credentials...";
    if (introHandshakeActionBtn) {
      introHandshakeActionBtn.disabled = true;
      introHandshakeActionBtn.textContent = "Exchanging Credentials...";
    }

    socket.emit("complete-handshake", {
      introductionId: state.introductionId,
      token: state.myTempToken,
      partnerToken: state.partnerTempToken || undefined
    });
  }

  manualHandshakeBtn.addEventListener("click", completeHandshake);
  introHandshakeActionBtn.addEventListener("click", completeHandshake);

  socket.on("full-session-start", (data) => {
    if (state.countdownInterval) clearInterval(state.countdownInterval);
    state.countdownInterval = null;
    state.handshakeSent = false;
    state.partnerTokenReceived = false;
    state.partnerVerified = false;

    manualHandshakeBtn.disabled = false;
    manualHandshakeBtn.textContent = "🔗 Verify Handshake & Connect Full";
    if (introHandshakeActionBtn) {
      introHandshakeActionBtn.disabled = false;
      introHandshakeActionBtn.textContent = "🔗 Verify Handshake & Connect Full";
    }

    state.partnerCode = data.partnerCode;
    state.partnerDisplayName = data.partnerDisplayName || null;
    updateConnectionUI("FULLY_CONNECTED");

    // Load recent PostgreSQL history if present
    clearMessages();
    if (Array.isArray(data.history) && data.history.length > 0) {
      data.history.forEach((msg) => {
        renderMessageBubble({
          id: msg.id,
          senderId: msg.sender_id,
          senderCode: msg.sender_id === state.userId ? state.permanentCode : state.partnerCode,
          text: msg.text,
          timestamp: msg.timestamp,
          replyTo: msg.reply_to,
          mode: "normal",
          deleted: msg.deleted === 1
        });
      });
      scrollToBottom();
    }

    showToast("🟢 Full Connection Established! Live chat active.", "success");
    playNotificationChime();
  });

  socket.on("handshake-failed", (data) => {
    state.handshakeSent = false;
    state.partnerVerified = false;
    manualHandshakeBtn.disabled = false;
    manualHandshakeBtn.textContent = "🔗 Verify Handshake & Connect Full";
    if (introHandshakeActionBtn) {
      introHandshakeActionBtn.disabled = false;
      introHandshakeActionBtn.textContent = "🔗 Verify Handshake & Connect Full";
    }
    showToast(data.message || "Handshake verification failed.", "error");
  });

  // End Session
  function requestEndSession() {
    if (confirm("Are you sure you want to end this connection?")) {
      socket.emit("end-session");
    }
  }

  disconnectBtn.addEventListener("click", requestEndSession);
  headerDisconnectBtn.addEventListener("click", requestEndSession);

  socket.on("full-session-end", (data) => {
    if (state.countdownInterval) clearInterval(state.countdownInterval);
    state.countdownInterval = null;

    showToast(data.reason || "The session has ended.", "info");
    updateConnectionUI("WAITING");
  });

  // Update partner name and avatar in chat header
  function updatePartnerHeaderUI() {
    if (state.connectionState === "TEMPORARY_INTRO" || state.connectionState === "FULLY_CONNECTED") {
      const name = state.partnerDisplayName || "Stranger";
      chatPartnerName.textContent = name;
      chatPartnerCode.textContent = state.partnerCode || "";
      partnerAvatar.textContent = state.partnerDisplayName ? state.partnerDisplayName[0].toUpperCase() : (state.partnerCode ? state.partnerCode[0] : "S");
    } else {
      chatPartnerName.textContent = "Stranger";
      chatPartnerCode.textContent = "----";
      partnerAvatar.textContent = "?";
    }
  }

  // Update UI Connection State Machine
  function updateConnectionUI(newState) {
    state.connectionState = newState;
    updatePartnerHeaderUI();

    if (newState === "OFFLINE") {
      chatStatusIndicator.className = "status-indicator offline";
      chatStatusText.textContent = "⚪ Offline";

      messageInput.disabled = true;
      sendBtn.disabled = true;
      sessionCard.classList.add("hidden");
      introBanner.classList.add("hidden");
      introTimerBadge.classList.add("hidden");
      privateBanner.classList.add("hidden");
      privateModeBadge.classList.add("hidden");
      headerDisconnectBtn.classList.add("hidden");

    } else if (newState === "WAITING") {
      chatStatusIndicator.className = "status-indicator waiting";
      chatStatusText.textContent = "🟡 Waiting for connection";

      messageInput.disabled = true;
      sendBtn.disabled = true;
      sessionCard.classList.add("hidden");
      introBanner.classList.add("hidden");
      introTimerBadge.classList.add("hidden");
      privateBanner.classList.add("hidden");
      privateModeBadge.classList.add("hidden");
      headerDisconnectBtn.classList.add("hidden");

      emptyChatState.classList.remove("hidden");
      messagesList.classList.add("hidden");
      clearMessages();
      cancelActiveReply();

    } else if (newState === "TEMPORARY_INTRO") {
      chatStatusIndicator.className = "status-indicator intro";
      chatStatusText.textContent = "🟡 Temporary Connection";

      messageInput.disabled = false;
      sendBtn.disabled = false;

      // Show temporary intro indicators
      introTimerBadge.classList.remove("hidden");
      introBanner.classList.remove("hidden");
      sessionCard.classList.remove("hidden");
      sessionBadge.textContent = "🟡 Temp Intro";
      sessionBadge.style.color = "var(--accent-amber)";
      const partnerDisplay = state.partnerDisplayName ? `${state.partnerDisplayName} (${state.partnerCode})` : state.partnerCode;
      connectedPartnerLabel.textContent = `Partner: ${partnerDisplay}`;
      myTempTokenEl.textContent = state.myTempToken || "----";
      partnerTempTokenEl.textContent = state.partnerTempToken || "Awaiting Exchange...";
      handshakeActionContainer.classList.remove("hidden");
      headerDisconnectBtn.classList.remove("hidden");

      emptyChatState.classList.add("hidden");
      messagesList.classList.remove("hidden");

      messageInput.focus();

    } else if (newState === "FULLY_CONNECTED") {
      chatStatusIndicator.className = "status-indicator connected";
      chatStatusText.textContent = "🟢 Fully Connected";

      messageInput.disabled = false;
      sendBtn.disabled = false;

      introTimerBadge.classList.add("hidden");
      introBanner.classList.add("hidden");
      handshakeActionContainer.classList.add("hidden");

      sessionCard.classList.remove("hidden");
      sessionBadge.textContent = "🟢 Connected";
      sessionBadge.style.color = "var(--accent-emerald)";
      const partnerDisplay = state.partnerDisplayName ? `${state.partnerDisplayName} (${state.partnerCode})` : state.partnerCode;
      connectedPartnerLabel.textContent = `Partner: ${partnerDisplay}`;
      headerDisconnectBtn.classList.remove("hidden");

      emptyChatState.classList.add("hidden");
      messagesList.classList.remove("hidden");

      messageInput.focus();
    }
  }

  // Real-Time Messaging Handlers
  composerForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text) return;

    // Send message to server
    socket.emit("send-message", {
      text,
      replyTo: state.activeReply ? state.activeReply.id : undefined
    });

    messageInput.value = "";
    cancelActiveReply();

    // Stop typing notification
    if (state.typingTimer) {
      clearTimeout(state.typingTimer);
      state.typingTimer = null;
    }
    socket.emit("stopTyping");
  });

  // Typing Indicator Logic
  messageInput.addEventListener("input", () => {
    if (state.connectionState !== "TEMPORARY_INTRO" && state.connectionState !== "FULLY_CONNECTED") {
      return;
    }

    socket.emit("typing");

    if (state.typingTimer) clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      socket.emit("stopTyping");
      state.typingTimer = null;
    }, 1500);
  });

  socket.on("partner-typing", (data) => {
    const name = data?.displayName || state.partnerDisplayName || "Stranger";
    const typingSpan = typingIndicator.querySelector("span");
    if (typingSpan) {
      typingSpan.textContent = `${name} is typing...`;
    }
    typingIndicator.classList.remove("hidden");
    scrollToBottom();
  });

  socket.on("partner-stopTyping", () => {
    typingIndicator.classList.add("hidden");
  });

  // Receive Message
  socket.on("receive-message", (msg) => {
    renderMessageBubble(msg);
    scrollToBottom();
    if (msg.senderId !== state.userId) {
      playNotificationChime();
    }
  });

  socket.on("message-error", (data) => {
    showToast(data.message || "Failed to send message.", "error");
  });

  // Message Bubble Rendering
  function renderMessageBubble(msg) {
    const isSent = msg.senderId === state.userId;
    const row = document.createElement("div");
    row.className = `message-row ${isSent ? "sent" : "received"}`;
    row.id = `msg-${msg.id}`;

    const bubble = document.createElement("div");
    bubble.className = `message-bubble ${msg.deleted ? "deleted-bubble" : ""}`;

    // Display sender name
    const senderName = isSent
      ? (state.displayName || "You")
      : (msg.senderName || state.partnerDisplayName || "Stranger");

    const senderNameEl = document.createElement("span");
    senderNameEl.className = "msg-sender-name";
    senderNameEl.textContent = isSent ? "You" : senderName;
    bubble.appendChild(senderNameEl);

    // Mode tag for intro or private
    if (msg.mode === "intro") {
      const modeTag = document.createElement("span");
      modeTag.className = "msg-mode-tag tag-intro";
      modeTag.textContent = "Intro";
      bubble.appendChild(modeTag);
    } else if (msg.mode === "private") {
      const modeTag = document.createElement("span");
      modeTag.className = "msg-mode-tag tag-private";
      modeTag.textContent = "Private";
      bubble.appendChild(modeTag);
    }

    // Quoted reply if message replies to something
    if (msg.replyTo) {
      const quoteBox = document.createElement("div");
      quoteBox.className = "quote-box";
      const referencedMsg = document.getElementById(`msg-${msg.replyTo}`);
      let quoteText = "Original message";
      if (referencedMsg) {
        const refBubble = referencedMsg.querySelector(".msg-text");
        if (refBubble) quoteText = refBubble.textContent;
      }
      quoteBox.innerHTML = `
        <span class="quote-sender">Replying to message</span>
        <span class="quote-snippet">${escapeHtml(quoteText)}</span>
      `;
      quoteBox.addEventListener("click", () => {
        const target = document.getElementById(`msg-${msg.replyTo}`);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
          target.style.transition = "transform 0.2s, background-color 0.2s";
          target.style.transform = "scale(1.03)";
          setTimeout(() => {
            target.style.transform = "scale(1)";
          }, 350);
        }
      });
      bubble.appendChild(quoteBox);
    }

    const textEl = document.createElement("div");
    textEl.className = "msg-text";
    textEl.textContent = msg.text;
    bubble.appendChild(textEl);

    row.appendChild(bubble);

    // Meta: Timestamp and Actions
    const meta = document.createElement("div");
    meta.className = "message-meta";

    const timeStr = formatTime(msg.timestamp);
    const timeEl = document.createElement("span");
    timeEl.textContent = timeStr;
    meta.appendChild(timeEl);

    if (!msg.deleted) {
      const actions = document.createElement("div");
      actions.className = "msg-actions";

      // Reply Button
      const replyBtn = document.createElement("button");
      replyBtn.className = "msg-action-btn";
      replyBtn.title = "Reply";
      replyBtn.innerHTML = "↩";
      replyBtn.addEventListener("click", () => {
        setReplyTarget(msg.id, msg.text, isSent ? "You" : senderName);
      });
      actions.appendChild(replyBtn);

      // Delete Button (only if sent by this user)
      if (isSent) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "msg-action-btn";
        deleteBtn.title = "Delete";
        deleteBtn.innerHTML = "🗑️";
        deleteBtn.addEventListener("click", () => {
          if (confirm("Delete this message?")) {
            socket.emit("delete-message", { messageId: msg.id });
          }
        });
        actions.appendChild(deleteBtn);
      }

      meta.appendChild(actions);
    }

    row.appendChild(meta);
    messagesList.appendChild(row);
  }

  // Deletion Updates
  socket.on("message-deleted", (data) => {
    const row = document.getElementById(`msg-${data.messageId}`);
    if (row) {
      const bubble = row.querySelector(".message-bubble");
      const textEl = row.querySelector(".msg-text");
      const actions = row.querySelector(".msg-actions");

      if (bubble) bubble.classList.add("deleted-bubble");
      if (textEl) textEl.textContent = data.text || "This message was deleted";
      if (actions) actions.remove();
    }
  });

  socket.on("delete-error", (data) => {
    showToast(data.message || "Failed to delete message.", "error");
  });

  // Reply Helpers
  function setReplyTarget(msgId, text, author) {
    state.activeReply = { id: msgId, text, author };
    replyAuthor.textContent = author;
    replySnippet.textContent = `"${text}"`;
    replyPreviewBar.classList.remove("hidden");
    messageInput.focus();
  }

  function cancelActiveReply() {
    state.activeReply = null;
    replyPreviewBar.classList.add("hidden");
    replySnippet.textContent = "";
  }

  cancelReplyBtn.addEventListener("click", cancelActiveReply);

  // Clear Message Stream
  function clearMessages() {
    messagesList.innerHTML = "";
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Built-in Emoji Picker
  const EMOJI_SETS = {
    smileys: [
      "😀","😃","😄","😁","😆","😅","🤣","😂","🙂","🙃","😉","😊","😇","🥰","😍","🤩","😘","😋","😛","😜","🤪","🤫","🤔","🤐","🥱","😴","😷","🤒","🤕"
    ],
    gestures: [
      "👋","🤚","🖐️","✋","🖖","👌","🤌","🤏","✌️","🤞","🤟","🤘","🤙","👈","👉","👆","👇","☝️","👍","👎","✊","👊","👏","🙌","👐","🤲","🤝","🙏"
    ],
    hearts: [
      "❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","✨","⭐","🌟","💫","🔥","💯","🎉"
    ],
    animals: [
      "🐶","🐱","🐭","🐹","🐰","🦊","🐻","🐼","🐨","🐯","🦁","🐮","🐷","🐸","🐵","🐔","🐧","🐦","🦆","🦅","🦉","🦇","🐺","🐴","🦄","🐝"
    ],
    objects: [
      "💡","🔦","🕯️","💣","🧨","📱","💻","⌨️","🖥️","🎧","📷","📹","🔍","🔬","📡","🔋","🔌","🔑","🔒","☕","🍕","🍔","🍿","🚀","✈️"
    ]
  };

  let currentEmojiCategory = "smileys";

  function populateEmojiGrid(category) {
    currentEmojiCategory = category;
    emojiGrid.innerHTML = "";
    const list = EMOJI_SETS[category] || EMOJI_SETS.smileys;
    list.forEach((emoji) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "emoji-item";
      btn.textContent = emoji;
      btn.addEventListener("click", () => {
        insertEmoji(emoji);
      });
      emojiGrid.appendChild(btn);
    });
  }

  function insertEmoji(emoji) {
    const input = messageInput;
    const start = input.selectionStart || input.value.length;
    const end = input.selectionEnd || input.value.length;
    const prev = input.value;
    input.value = prev.substring(0, start) + emoji + prev.substring(end);
    input.focus();
    input.selectionStart = input.selectionEnd = start + emoji.length;
  }

  emojiToggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isHidden = emojiPickerDropdown.classList.contains("hidden");
    if (isHidden) {
      populateEmojiGrid(currentEmojiCategory);
      emojiPickerDropdown.classList.remove("hidden");
    } else {
      emojiPickerDropdown.classList.add("hidden");
    }
  });

  document.querySelectorAll(".emoji-tab").forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.stopPropagation();
      document.querySelectorAll(".emoji-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      populateEmojiGrid(tab.getAttribute("data-category"));
    });
  });

  // Close emoji picker when clicking outside
  document.addEventListener("click", (e) => {
    if (!emojiPickerDropdown.contains(e.target) && e.target !== emojiToggleBtn) {
      emojiPickerDropdown.classList.add("hidden");
    }
  });

  // PRIVATE MODE REQUEST & HANDLING
  socket.on("private-mode-pending", () => {
    privateWaitingModal.classList.remove("hidden");
  });

  cancelPrivateRequestBtn.addEventListener("click", () => {
    privateWaitingModal.classList.add("hidden");
    showToast("Cancelled private mode request.", "info");
  });

  socket.on("private-mode-requested", (data) => {
    state.pendingPrivateRequestId = data.requestId;
    const requesterDisplay = data.requesterName && data.requesterName !== "Stranger"
      ? `${data.requesterName} (${data.requesterCode})`
      : (data.requesterCode || "Stranger");
    privateModalRequester.textContent = requesterDisplay;
    privateModal.classList.remove("hidden");
    playNotificationChime();
  });

  socket.on("private-mode-request-cancelled", () => {
    state.pendingPrivateRequestId = null;
    privateModal.classList.add("hidden");
    showToast("Private mode request cancelled.", "info");
  });

  privateAcceptBtn.addEventListener("click", () => {
    privateModal.classList.add("hidden");
    socket.emit("private-mode-response", { accept: true, requestId: state.pendingPrivateRequestId });
    state.pendingPrivateRequestId = null;
  });

  privateDeclineBtn.addEventListener("click", () => {
    privateModal.classList.add("hidden");
    socket.emit("private-mode-response", { accept: false, requestId: state.pendingPrivateRequestId });
    state.pendingPrivateRequestId = null;
  });

  socket.on("private-mode-declined", (data) => {
    privateWaitingModal.classList.add("hidden");
    privateModal.classList.add("hidden");
    showToast(data.message || "Private mode request declined.", "info");
  });

  // Private Mode Active
  socket.on("private-mode-start", () => {
    privateWaitingModal.classList.add("hidden");
    privateModal.classList.add("hidden");

    state.chatMode = "PRIVATE";
    chatStatusIndicator.className = "status-indicator private";
    chatStatusText.textContent = "🔒 Private Mode";

    privateModeBadge.classList.remove("hidden");
    privateBanner.classList.remove("hidden");

    clearMessages();
    showToast("🔒 Ephemeral Private Mode started. Messages will not be saved.", "info");
    playNotificationChime();
  });

  // Leaving Private Mode
  function leavePrivateMode() {
    if (confirm("Leave Private Mode and return to normal chat?")) {
      socket.emit("leave-private-mode");
    }
  }

  leavePrivateBtn.addEventListener("click", leavePrivateMode);
  leavePrivateBannerBtn.addEventListener("click", leavePrivateMode);

  socket.on("private-mode-end", (data) => {
    state.chatMode = "NORMAL";
    privateModeBadge.classList.add("hidden");
    privateBanner.classList.add("hidden");

    chatStatusIndicator.className = "status-indicator connected";
    chatStatusText.textContent = "🟢 Fully Connected";

    clearMessages();
    if (Array.isArray(data.history) && data.history.length > 0) {
      data.history.forEach((msg) => {
        renderMessageBubble({
          id: msg.id,
          senderId: msg.sender_id,
          senderCode: msg.sender_id === state.userId ? state.permanentCode : state.partnerCode,
          text: msg.text,
          timestamp: msg.timestamp,
          replyTo: msg.reply_to,
          mode: "normal",
          deleted: msg.deleted === 1
        });
      });
      scrollToBottom();
    }

    showToast("Exited Private Mode. Returned to normal chat.", "info");
  });

  socket.on("system-notice", (data) => {
    showToast(data.message, "info");
  });

  socket.on("system-error", (data) => {
    showToast(data.message, "error");
  });

  // User Profile & Display Name Management
  function updateProfileUI() {
    const name = state.displayName ? state.displayName.trim() : "";
    if (myDisplayNameText) {
      myDisplayNameText.textContent = name || "Anonymous";
    }
    if (myAvatarPreview) {
      myAvatarPreview.textContent = name ? name[0].toUpperCase() : "?";
    }
  }

  function showEditNameForm() {
    if (!displayNameForm) return;
    displayNameForm.classList.remove("hidden");
    if (displayNameInput) {
      displayNameInput.value = state.displayName || "";
      displayNameInput.focus();
      displayNameInput.select();
    }
  }

  function hideEditNameForm() {
    if (!displayNameForm) return;
    displayNameForm.classList.add("hidden");
  }

  function saveDisplayName(newName) {
    const cleanName = (newName || "").trim().slice(0, 24);
    state.displayName = cleanName || null;
    if (cleanName) {
      localStorage.setItem("letschat_display_name", cleanName);
    } else {
      localStorage.removeItem("letschat_display_name");
    }
    updateProfileUI();
    hideEditNameForm();

    socket.emit("update-display-name", { displayName: cleanName });
    showToast(cleanName ? `Name updated to: ${cleanName}` : "Name reset to Anonymous", "success");
  }

  if (editNameBtn) {
    editNameBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showEditNameForm();
    });
  }

  if (profilePreviewRow) {
    profilePreviewRow.addEventListener("click", () => {
      showEditNameForm();
    });
  }

  if (cancelNameBtn) {
    cancelNameBtn.addEventListener("click", () => {
      hideEditNameForm();
    });
  }

  if (displayNameForm) {
    displayNameForm.addEventListener("submit", (e) => {
      e.preventDefault();
      saveDisplayName(displayNameInput.value);
    });
  }

  socket.on("display-name-updated", (data) => {
    state.displayName = data.displayName || null;
    if (data.displayName) {
      localStorage.setItem("letschat_display_name", data.displayName);
    } else {
      localStorage.removeItem("letschat_display_name");
    }
    updateProfileUI();
  });

  // Collapsible Sidebar Management (Laptop/PC & Mobile)
  function setSidebarCollapsed(collapsed) {
    state.sidebarCollapsed = collapsed;
    localStorage.setItem("letschat_sidebar_collapsed", collapsed ? "true" : "false");

    if (collapsed) {
      sidebar.classList.add("collapsed");
      if (appContainer) appContainer.classList.add("sidebar-collapsed");
      if (toggleSidebarBtn) {
        toggleSidebarBtn.setAttribute("title", "Expand sidebar (Ctrl+B)");
        toggleSidebarBtn.setAttribute("aria-label", "Expand sidebar");
      }
    } else {
      sidebar.classList.remove("collapsed");
      if (appContainer) appContainer.classList.remove("sidebar-collapsed");
      if (toggleSidebarBtn) {
        toggleSidebarBtn.setAttribute("title", "Collapse sidebar (Ctrl+B)");
        toggleSidebarBtn.setAttribute("aria-label", "Collapse sidebar");
      }
    }
  }

  function toggleSidebar() {
    if (window.innerWidth > 768) {
      setSidebarCollapsed(!state.sidebarCollapsed);
    } else {
      sidebar.classList.toggle("open");
    }
  }

  if (collapseSidebarBtn) {
    collapseSidebarBtn.addEventListener("click", () => {
      if (window.innerWidth > 768) {
        setSidebarCollapsed(true);
      } else {
        sidebar.classList.remove("open");
      }
    });
  }

  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener("click", toggleSidebar);
  }

  if (openSidebarBtn && openSidebarBtn !== toggleSidebarBtn) {
    openSidebarBtn.addEventListener("click", () => {
      sidebar.classList.add("open");
    });
  }

  if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener("click", () => {
      sidebar.classList.remove("open");
    });
  }

  // Keyboard shortcut: Ctrl+B or Cmd+B to toggle sidebar
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // Restore saved desktop sidebar collapsed preference
  const savedCollapsed = localStorage.getItem("letschat_sidebar_collapsed") === "true";
  if (savedCollapsed && window.innerWidth > 768) {
    setSidebarCollapsed(true);
  }

  // Initialize profile display name
  updateProfileUI();

  // =========================================================================
  // SETTINGS & SECURE CODE VAULT SUBSYSTEM
  // =========================================================================
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // Elements: Modal & Triggers
  const settingsModal = document.getElementById("settings-modal");
  const openSettingsBtn = document.getElementById("open-settings-btn");
  const headerSettingsBtn = document.getElementById("header-settings-btn");
  const openVaultFromConnectBtn = document.getElementById("open-vault-from-connect-btn");
  const closeSettingsBtn = document.getElementById("close-settings-btn");

  // Elements: Tabs
  const tabBtnAppearance = document.getElementById("tab-btn-appearance");
  const tabBtnVault = document.getElementById("tab-btn-vault");
  const tabContentAppearance = document.getElementById("tab-content-appearance");
  const tabContentVault = document.getElementById("tab-content-vault");
  const vaultTabStatusPill = document.getElementById("vault-tab-status-pill");

  // Elements: Appearance & Sound
  const themeDarkBtn = document.getElementById("theme-dark-btn");
  const themeLightBtn = document.getElementById("theme-light-btn");
  const soundToggleInput = document.getElementById("sound-toggle-input");
  const soundStateLabel = document.getElementById("sound-state-label");
  const testSoundBtn = document.getElementById("test-sound-btn");

  // Elements: Vault Subviews
  const vaultSetupView = document.getElementById("vault-setup-view");
  const vaultLockedView = document.getElementById("vault-locked-view");
  const vaultUnlockedView = document.getElementById("vault-unlocked-view");

  // Elements: Vault Setup Form
  const vaultSetupForm = document.getElementById("vault-setup-form");
  const vaultNewPassword = document.getElementById("vault-new-password");
  const vaultConfirmPassword = document.getElementById("vault-confirm-password");
  const vaultSetupError = document.getElementById("vault-setup-error");

  // Elements: Vault Unlock Form
  const vaultUnlockForm = document.getElementById("vault-unlock-form");
  const vaultUnlockPassword = document.getElementById("vault-unlock-password");
  const vaultUnlockError = document.getElementById("vault-unlock-error");
  const vaultResetTriggerBtn = document.getElementById("vault-reset-trigger-btn");
  const vaultResetConfirmCard = document.getElementById("vault-reset-confirm-card");
  const vaultResetCancelBtn = document.getElementById("vault-reset-cancel-btn");
  const vaultResetProceedBtn = document.getElementById("vault-reset-proceed-btn");

  // Elements: Vault Unlocked Controls
  const vaultAddToggleBtn = document.getElementById("vault-add-toggle-btn");
  const vaultChangePassToggleBtn = document.getElementById("vault-change-pass-toggle-btn");
  const vaultLockBtn = document.getElementById("vault-lock-btn");

  // Elements: Contact Form
  const vaultAddFormCard = document.getElementById("vault-add-form-card");
  const vaultFormTitle = document.getElementById("vault-form-title");
  const vaultContactForm = document.getElementById("vault-contact-form");
  const vaultContactEditId = document.getElementById("vault-contact-edit-id");
  const vaultContactName = document.getElementById("vault-contact-name");
  const vaultContactCode = document.getElementById("vault-contact-code");
  const vaultContactNote = document.getElementById("vault-contact-note");
  const vaultFormError = document.getElementById("vault-form-error");
  const vaultFormCancelBtn = document.getElementById("vault-form-cancel-btn");

  // Elements: Change Password Form
  const vaultChangePassCard = document.getElementById("vault-change-pass-card");
  const vaultChangePassForm = document.getElementById("vault-change-pass-form");
  const vaultOldPass = document.getElementById("vault-old-pass");
  const vaultNewPassVal = document.getElementById("vault-new-pass-val");
  const vaultChangePassError = document.getElementById("vault-change-pass-error");
  const vaultChangePassCancelBtn = document.getElementById("vault-change-pass-cancel-btn");

  // Elements: List & Search
  const vaultSearchInput = document.getElementById("vault-search-input");
  const vaultContactsList = document.getElementById("vault-contacts-list");

  // In-Memory Vault State
  const vaultState = {
    isUnlocked: false,
    key: null,
    saltHex: null,
    contacts: [],
    autoLockTimer: null
  };

  // --- CRYPTOGRAPHY HELPERS (AES-GCM 256 + PBKDF2) ---
  function bufToHex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function hexToBuf(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
    }
    return bytes;
  }

  function bufToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  function base64ToBuf(base64) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  async function deriveVaultKey(password, saltUint8) {
    const baseKey = await crypto.subtle.importKey(
      "raw",
      enc.encode(password),
      { name: "PBKDF2" },
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: saltUint8,
        iterations: 100000,
        hash: "SHA-256"
      },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function computePasswordVerifier(password, saltUint8) {
    const passBytes = enc.encode(password);
    const combined = new Uint8Array(passBytes.length + saltUint8.length);
    combined.set(passBytes);
    combined.set(saltUint8, passBytes.length);
    const digest = await crypto.subtle.digest("SHA-256", combined);
    return bufToHex(digest);
  }

  async function encryptVaultPayload(plainText, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = enc.encode(plainText);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encoded
    );
    return {
      ivHex: bufToHex(iv),
      dataB64: bufToBase64(ciphertext)
    };
  }

  async function decryptVaultPayload(dataB64, ivHex, key) {
    const iv = hexToBuf(ivHex);
    const ciphertext = base64ToBuf(dataB64);
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext
    );
    return dec.decode(decrypted);
  }

  // --- VAULT PERSISTENCE & STATE MANAGEMENT ---
  function getVaultMeta() {
    try {
      const raw = localStorage.getItem("letschat_vault_meta");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveVaultMeta(meta) {
    localStorage.setItem("letschat_vault_meta", JSON.stringify(meta));
  }

  async function saveVaultContactsToStorage() {
    if (!vaultState.key || !vaultState.isUnlocked) return;
    const meta = getVaultMeta();
    if (!meta) return;

    const plain = JSON.stringify(vaultState.contacts);
    const encResult = await encryptVaultPayload(plain, vaultState.key);
    localStorage.setItem("letschat_vault_data", encResult.dataB64);
    meta.lastIv = encResult.ivHex;
    saveVaultMeta(meta);
  }

  function resetAutoLock() {
    if (vaultState.autoLockTimer) clearTimeout(vaultState.autoLockTimer);
    if (vaultState.isUnlocked) {
      // Auto lock after 15 minutes of inactivity
      vaultState.autoLockTimer = setTimeout(() => {
        lockVault();
        showToast("Vault automatically locked due to inactivity", "info");
      }, 15 * 60 * 1000);
    }
  }

  function lockVault() {
    vaultState.isUnlocked = false;
    vaultState.key = null;
    vaultState.saltHex = null;
    vaultState.contacts = [];
    if (vaultState.autoLockTimer) clearTimeout(vaultState.autoLockTimer);

    if (vaultUnlockPassword) vaultUnlockPassword.value = "";
    if (vaultUnlockError) vaultUnlockError.classList.add("hidden");
    if (vaultResetConfirmCard) vaultResetConfirmCard.classList.add("hidden");
    if (vaultResetTriggerBtn) vaultResetTriggerBtn.classList.remove("active");

    resetPasswordToggles();

    vaultTabStatusPill.textContent = "🔒 Locked";
    vaultTabStatusPill.classList.remove("unlocked");

    refreshVaultView();
  }

  function refreshVaultView() {
    const meta = getVaultMeta();
    if (!meta) {
      // No password setup yet
      vaultSetupView.classList.remove("hidden");
      vaultLockedView.classList.add("hidden");
      vaultUnlockedView.classList.add("hidden");
      vaultTabStatusPill.textContent = "⚙️ Unset";
      vaultTabStatusPill.classList.remove("unlocked");
    } else if (!vaultState.isUnlocked) {
      // Locked
      vaultSetupView.classList.add("hidden");
      vaultLockedView.classList.remove("hidden");
      vaultUnlockedView.classList.add("hidden");
      vaultTabStatusPill.textContent = "🔒 Locked";
      vaultTabStatusPill.classList.remove("unlocked");
    } else {
      // Unlocked
      vaultSetupView.classList.add("hidden");
      vaultLockedView.classList.add("hidden");
      vaultUnlockedView.classList.remove("hidden");
      vaultTabStatusPill.textContent = "🔓 Unlocked";
      vaultTabStatusPill.classList.add("unlocked");
      renderVaultContacts(vaultSearchInput ? vaultSearchInput.value.trim() : "");
    }
  }

  // --- RENDER SAVED CODES LIST ---
  function renderVaultContacts(filter = "") {
    if (!vaultContactsList) return;
    vaultContactsList.innerHTML = "";

    const query = filter.toLowerCase();
    const filtered = vaultState.contacts.filter((c) => {
      if (!query) return true;
      return (
        (c.name && c.name.toLowerCase().includes(query)) ||
        (c.code && c.code.toLowerCase().includes(query)) ||
        (c.note && c.note.toLowerCase().includes(query))
      );
    });

    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "vault-empty-state";
      empty.innerHTML = `
        <span class="vault-empty-icon">${vaultState.contacts.length === 0 ? "📇" : "🔍"}</span>
        <h5 class="vault-empty-title">${vaultState.contacts.length === 0 ? "No Saved Codes Yet" : "No Matches Found"}</h5>
        <p class="vault-empty-text">
          ${vaultState.contacts.length === 0
            ? "Click '+ Add Code' to save friends' permanent codes securely behind your master password."
            : "No saved contact matched your search term."}
        </p>
      `;
      vaultContactsList.appendChild(empty);
      return;
    }

    filtered.forEach((contact) => {
      const card = document.createElement("div");
      card.className = "vault-contact-card";
      card.id = `vault-contact-${contact.id}`;

      // Format code with standard dash if 8 chars without dash
      const formattedCode = formatPermanentCodeDisplay(contact.code);

      const infoDiv = document.createElement("div");
      infoDiv.className = "vault-contact-info";

      const nameRow = document.createElement("div");
      nameRow.className = "vault-contact-name-row";

      const nameSpan = document.createElement("span");
      nameSpan.className = "vault-contact-name";
      nameSpan.textContent = contact.name || "Unnamed Contact";

      const codeBadge = document.createElement("span");
      codeBadge.className = "vault-code-badge";
      codeBadge.textContent = formattedCode;

      nameRow.appendChild(nameSpan);
      nameRow.appendChild(codeBadge);
      infoDiv.appendChild(nameRow);

      if (contact.note) {
        const noteSpan = document.createElement("span");
        noteSpan.className = "vault-contact-note";
        noteSpan.textContent = contact.note;
        infoDiv.appendChild(noteSpan);
      }

      const actionsDiv = document.createElement("div");
      actionsDiv.className = "vault-contact-actions";

      // Connect button
      const connectBtn = document.createElement("button");
      connectBtn.className = "btn btn-primary btn-xs";
      connectBtn.textContent = "Connect";
      connectBtn.title = `Connect to ${contact.name || formattedCode}`;
      connectBtn.addEventListener("click", () => {
        closeSettings();
        // Insert code into connect card
        const partnerInput = document.getElementById("partner-code-input");
        if (partnerInput) {
          partnerInput.value = formattedCode;
          partnerInput.dispatchEvent(new Event("input"));
          partnerInput.focus();
        }
        // Expand sidebar if on desktop
        if (state.sidebarCollapsed) {
          setSidebarCollapsed(false);
        }
        // Open sidebar drawer if on mobile
        if (window.innerWidth <= 768) {
          sidebar.classList.add("open");
        }
        showToast(`Filled permanent code for ${contact.name || formattedCode}`, "info");
      });

      // Copy button
      const copyBtn = document.createElement("button");
      copyBtn.className = "icon-btn icon-btn-sm";
      copyBtn.title = "Copy code";
      copyBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
      `;
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(formattedCode);
          showToast(`Copied ${formattedCode} to clipboard!`, "success");
        } catch {
          showToast("Failed to copy code", "error");
        }
      });

      // Edit button
      const editBtn = document.createElement("button");
      editBtn.className = "icon-btn icon-btn-sm";
      editBtn.title = "Edit contact";
      editBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
      `;
      editBtn.addEventListener("click", () => {
        openEditContactForm(contact);
      });

      // Delete button
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "icon-btn icon-btn-sm danger-hover";
      deleteBtn.title = "Delete contact";
      deleteBtn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      deleteBtn.addEventListener("click", async () => {
        if (confirm(`Remove saved code for "${contact.name || formattedCode}"?`)) {
          vaultState.contacts = vaultState.contacts.filter((c) => c.id !== contact.id);
          await saveVaultContactsToStorage();
          renderVaultContacts(vaultSearchInput ? vaultSearchInput.value.trim() : "");
          showToast("Contact removed from vault", "info");
        }
      });

      actionsDiv.appendChild(connectBtn);
      actionsDiv.appendChild(copyBtn);
      actionsDiv.appendChild(editBtn);
      actionsDiv.appendChild(deleteBtn);

      card.appendChild(infoDiv);
      card.appendChild(actionsDiv);
      vaultContactsList.appendChild(card);
    });
  }

  function formatPermanentCodeDisplay(raw) {
    if (!raw) return "";
    const clean = raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (clean.length === 8) {
      return `${clean.slice(0, 4)}-${clean.slice(4)}`;
    }
    return clean;
  }

  function openEditContactForm(contact) {
    vaultChangePassCard.classList.add("hidden");
    vaultAddFormCard.classList.remove("hidden");
    vaultFormTitle.textContent = "Edit Saved Permanent Code";
    vaultContactEditId.value = contact.id;
    vaultContactName.value = contact.name || "";
    vaultContactCode.value = formatPermanentCodeDisplay(contact.code);
    vaultContactNote.value = contact.note || "";
    vaultFormError.classList.add("hidden");
    vaultContactName.focus();
  }

  // --- THEME ENGINE ---
  function applyTheme(theme) {
    state.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("letschat_theme", theme);

    if (themeDarkBtn) themeDarkBtn.classList.toggle("active", theme === "dark");
    if (themeLightBtn) themeLightBtn.classList.toggle("active", theme === "light");
  }

  // --- SOUND ENGINE ---
  function setSoundEnabled(enabled) {
    state.soundEnabled = enabled;
    localStorage.setItem("letschat_sound_enabled", enabled ? "true" : "false");
    if (soundToggleInput) soundToggleInput.checked = enabled;
    if (soundStateLabel) {
      soundStateLabel.textContent = enabled ? "Sound is enabled" : "Sound is muted";
    }
  }

  // --- MODAL CONTROLS & TAB SWITCHING ---
  function openSettings(initialTab = "appearance") {
    settingsModal.classList.remove("hidden");
    switchSettingsTab(initialTab);
    resetAutoLock();
  }

  function closeSettings() {
    settingsModal.classList.add("hidden");
    if (vaultAddFormCard) vaultAddFormCard.classList.add("hidden");
    if (vaultChangePassCard) vaultChangePassCard.classList.add("hidden");
    if (vaultResetConfirmCard) vaultResetConfirmCard.classList.add("hidden");
    if (vaultResetTriggerBtn) vaultResetTriggerBtn.classList.remove("active");
    resetPasswordToggles();
  }

  function switchSettingsTab(tabName) {
    if (tabName === "vault") {
      tabBtnVault.classList.add("active");
      tabBtnVault.setAttribute("aria-selected", "true");
      tabBtnAppearance.classList.remove("active");
      tabBtnAppearance.setAttribute("aria-selected", "false");

      tabContentVault.classList.remove("hidden");
      tabContentAppearance.classList.add("hidden");

      refreshVaultView();
      if (!vaultState.isUnlocked && vaultUnlockPassword && !vaultLockedView.classList.contains("hidden")) {
        setTimeout(() => vaultUnlockPassword.focus(), 50);
      }
    } else {
      tabBtnAppearance.classList.add("active");
      tabBtnAppearance.setAttribute("aria-selected", "true");
      tabBtnVault.classList.remove("active");
      tabBtnVault.setAttribute("aria-selected", "false");

      tabContentAppearance.classList.remove("hidden");
      tabContentVault.classList.add("hidden");
    }
  }

  // --- EVENT LISTENERS: MODAL & TABS ---
  if (openSettingsBtn) {
    openSettingsBtn.addEventListener("click", () => openSettings("appearance"));
  }
  if (headerSettingsBtn) {
    headerSettingsBtn.addEventListener("click", () => openSettings("appearance"));
  }
  if (openVaultFromConnectBtn) {
    openVaultFromConnectBtn.addEventListener("click", () => openSettings("vault"));
  }
  if (closeSettingsBtn) {
    closeSettingsBtn.addEventListener("click", closeSettings);
  }

  // Close modal when clicking on backdrop
  settingsModal.addEventListener("click", (e) => {
    if (e.target === settingsModal) {
      closeSettings();
    }
  });

  // Escape key to close settings modal
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !settingsModal.classList.contains("hidden")) {
      closeSettings();
    }
  });

  // Tab buttons
  tabBtnAppearance.addEventListener("click", () => switchSettingsTab("appearance"));
  tabBtnVault.addEventListener("click", () => switchSettingsTab("vault"));

  // Theme selection buttons
  themeDarkBtn.addEventListener("click", () => {
    applyTheme("dark");
    showToast("Switched to Dark Mode", "info");
  });
  themeLightBtn.addEventListener("click", () => {
    applyTheme("light");
    showToast("Switched to Light Mode", "info");
  });

  // Sound toggle
  soundToggleInput.addEventListener("change", () => {
    setSoundEnabled(soundToggleInput.checked);
    showToast(soundToggleInput.checked ? "Notification sound enabled" : "Notification sound muted", "info");
  });

  // Test sound button
  testSoundBtn.addEventListener("click", () => {
    playNotificationChime(true); // force play for preview
    showToast("Notification chime test played", "info");
  });

  // --- EVENT LISTENERS: VAULT SETUP FORM ---
  vaultSetupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = vaultNewPassword.value;
    const confirmPass = vaultConfirmPassword.value;

    if (!pass || pass.length < 4) {
      vaultSetupError.textContent = "Password must be at least 4 characters long.";
      vaultSetupError.classList.remove("hidden");
      return;
    }
    if (pass !== confirmPass) {
      vaultSetupError.textContent = "Passwords do not match.";
      vaultSetupError.classList.remove("hidden");
      return;
    }

    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltHex = bufToHex(salt);
      const derivedKey = await deriveVaultKey(pass, salt);
      const verifier = await computePasswordVerifier(pass, salt);

      // Encrypt initial empty array
      const initialContacts = [];
      const encResult = await encryptVaultPayload(JSON.stringify(initialContacts), derivedKey);

      saveVaultMeta({
        saltHex: saltHex,
        verifier: verifier,
        lastIv: encResult.ivHex,
        createdAt: new Date().toISOString()
      });
      localStorage.setItem("letschat_vault_data", encResult.dataB64);

      vaultState.isUnlocked = true;
      vaultState.key = derivedKey;
      vaultState.saltHex = saltHex;
      vaultState.contacts = initialContacts;

      vaultSetupError.classList.add("hidden");
      vaultNewPassword.value = "";
      vaultConfirmPassword.value = "";

      refreshVaultView();
      showToast("Master password set! Vault is now open.", "success");
      resetAutoLock();
    } catch (err) {
      console.error("Error setting up vault:", err);
      vaultSetupError.textContent = "Failed to create vault. Please try again.";
      vaultSetupError.classList.remove("hidden");
    }
  });

  // --- EVENT LISTENERS: VAULT UNLOCK FORM ---
  vaultUnlockForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const pass = vaultUnlockPassword.value;
    const meta = getVaultMeta();

    if (!meta) {
      refreshVaultView();
      return;
    }

    try {
      const saltUint8 = hexToBuf(meta.saltHex);
      const testVerifier = await computePasswordVerifier(pass, saltUint8);

      if (testVerifier !== meta.verifier) {
        vaultUnlockError.textContent = "Incorrect master password. Please try again.";
        vaultUnlockError.classList.remove("hidden");
        return;
      }

      const derivedKey = await deriveVaultKey(pass, saltUint8);
      const encDataB64 = localStorage.getItem("letschat_vault_data") || "";

      let contacts = [];
      if (encDataB64 && meta.lastIv) {
        try {
          const decryptedPlain = await decryptVaultPayload(encDataB64, meta.lastIv, derivedKey);
          contacts = JSON.parse(decryptedPlain);
        } catch (decryptErr) {
          console.warn("Could not decrypt contacts payload:", decryptErr);
        }
      }

      vaultState.isUnlocked = true;
      vaultState.key = derivedKey;
      vaultState.saltHex = meta.saltHex;
      vaultState.contacts = contacts;

      vaultUnlockError.classList.add("hidden");
      vaultUnlockPassword.value = "";

      refreshVaultView();
      showToast("Vault unlocked successfully", "success");
      resetAutoLock();
    } catch (err) {
      console.error("Unlock error:", err);
      vaultUnlockError.textContent = "Error unlocking vault. Please try again.";
      vaultUnlockError.classList.remove("hidden");
    }
  });

  // --- RESET VAULT LOGIC (In-app confirmation, bypasses iframe dialog blocks) ---
  if (vaultResetTriggerBtn) {
    vaultResetTriggerBtn.addEventListener("click", () => {
      if (!vaultResetConfirmCard) return;
      const isHidden = vaultResetConfirmCard.classList.contains("hidden");
      if (isHidden) {
        vaultResetConfirmCard.classList.remove("hidden");
        vaultResetTriggerBtn.classList.add("active");
        vaultResetTriggerBtn.setAttribute("aria-expanded", "true");
        if (vaultResetCancelBtn) {
          setTimeout(() => vaultResetCancelBtn.focus(), 50);
        }
      } else {
        vaultResetConfirmCard.classList.add("hidden");
        vaultResetTriggerBtn.classList.remove("active");
        vaultResetTriggerBtn.setAttribute("aria-expanded", "false");
      }
    });
  }

  if (vaultResetCancelBtn) {
    vaultResetCancelBtn.addEventListener("click", () => {
      if (vaultResetConfirmCard) vaultResetConfirmCard.classList.add("hidden");
      if (vaultResetTriggerBtn) {
        vaultResetTriggerBtn.classList.remove("active");
        vaultResetTriggerBtn.setAttribute("aria-expanded", "false");
        vaultResetTriggerBtn.focus();
      }
    });
  }

  if (vaultResetProceedBtn) {
    vaultResetProceedBtn.addEventListener("click", () => {
      // 1. Permanently erase stored encrypted vault payload & verification metadata
      localStorage.removeItem("letschat_vault_meta");
      localStorage.removeItem("letschat_vault_data");

      // 2. Clear all sensitive in-memory vault state
      vaultState.key = null;
      vaultState.saltHex = null;
      vaultState.contacts = [];
      vaultState.isUnlocked = false;
      if (vaultState.autoLockTimer) clearTimeout(vaultState.autoLockTimer);

      // 3. Reset all vault input fields & toggle states
      if (vaultUnlockPassword) vaultUnlockPassword.value = "";
      if (vaultUnlockError) vaultUnlockError.classList.add("hidden");
      if (vaultSetupForm) vaultSetupForm.reset();
      if (vaultSetupError) vaultSetupError.classList.add("hidden");
      resetPasswordToggles();

      // 4. Hide confirmation card & deactivate trigger
      if (vaultResetConfirmCard) vaultResetConfirmCard.classList.add("hidden");
      if (vaultResetTriggerBtn) {
        vaultResetTriggerBtn.classList.remove("active");
        vaultResetTriggerBtn.setAttribute("aria-expanded", "false");
      }

      // 5. Update UI view back to Setup view
      refreshVaultView();
      showToast("Vault reset successfully! You can now configure a new password.", "info");

      // 6. Automatically focus the new password field
      if (vaultNewPassword) {
        setTimeout(() => vaultNewPassword.focus(), 150);
      }
    });
  }

  // --- UNLOCKED VAULT CONTROLS ---
  vaultLockBtn.addEventListener("click", () => {
    lockVault();
    showToast("Vault locked", "info");
  });

  vaultAddToggleBtn.addEventListener("click", () => {
    vaultChangePassCard.classList.add("hidden");
    if (vaultAddFormCard.classList.contains("hidden")) {
      vaultAddFormCard.classList.remove("hidden");
      vaultFormTitle.textContent = "Save Other User's Permanent Code";
      vaultContactEditId.value = "";
      vaultContactForm.reset();
      vaultFormError.classList.add("hidden");
      vaultContactName.focus();
    } else {
      vaultAddFormCard.classList.add("hidden");
    }
    resetAutoLock();
  });

  vaultFormCancelBtn.addEventListener("click", () => {
    vaultAddFormCard.classList.add("hidden");
    vaultContactForm.reset();
    vaultFormError.classList.add("hidden");
    resetAutoLock();
  });

  // Contact Code Auto-formatting in Input
  vaultContactCode.addEventListener("input", (e) => {
    const raw = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    if (raw.length <= 4) {
      e.target.value = raw;
    } else {
      e.target.value = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    }
  });

  // Contact Form Save
  vaultContactForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = vaultContactName.value.trim();
    const codeRaw = vaultContactCode.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const note = vaultContactNote.value.trim();
    const editId = vaultContactEditId.value;

    if (!name) {
      vaultFormError.textContent = "Please enter a contact name or label.";
      vaultFormError.classList.remove("hidden");
      return;
    }

    if (codeRaw.length !== 8) {
      vaultFormError.textContent = "Permanent code must be 8 alphanumeric characters.";
      vaultFormError.classList.remove("hidden");
      return;
    }

    try {
      if (editId) {
        // Edit existing
        const idx = vaultState.contacts.findIndex((c) => c.id === editId);
        if (idx !== -1) {
          vaultState.contacts[idx].name = name;
          vaultState.contacts[idx].code = codeRaw;
          vaultState.contacts[idx].note = note;
          vaultState.contacts[idx].updatedAt = new Date().toISOString();
        }
      } else {
        // Add new
        vaultState.contacts.push({
          id: `vc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          name: name,
          code: codeRaw,
          note: note,
          createdAt: new Date().toISOString()
        });
      }

      await saveVaultContactsToStorage();
      vaultAddFormCard.classList.add("hidden");
      vaultContactForm.reset();
      vaultFormError.classList.add("hidden");

      renderVaultContacts(vaultSearchInput ? vaultSearchInput.value.trim() : "");
      showToast(editId ? "Contact updated!" : "Permanent code saved to vault!", "success");
      resetAutoLock();
    } catch (err) {
      console.error("Error saving contact:", err);
      vaultFormError.textContent = "Failed to save contact. Please try again.";
      vaultFormError.classList.remove("hidden");
    }
  });

  // --- CHANGE PASSWORD CONTROLS ---
  vaultChangePassToggleBtn.addEventListener("click", () => {
    vaultAddFormCard.classList.add("hidden");
    if (vaultChangePassCard.classList.contains("hidden")) {
      vaultChangePassCard.classList.remove("hidden");
      vaultChangePassForm.reset();
      vaultChangePassError.classList.add("hidden");
      vaultOldPass.focus();
    } else {
      vaultChangePassCard.classList.add("hidden");
    }
    resetAutoLock();
  });

  vaultChangePassCancelBtn.addEventListener("click", () => {
    vaultChangePassCard.classList.add("hidden");
    vaultChangePassForm.reset();
    vaultChangePassError.classList.add("hidden");
    resetAutoLock();
  });

  vaultChangePassForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const oldPass = vaultOldPass.value;
    const newPass = vaultNewPassVal.value;
    const meta = getVaultMeta();

    if (!meta) return;

    if (!newPass || newPass.length < 4) {
      vaultChangePassError.textContent = "New password must be at least 4 characters long.";
      vaultChangePassError.classList.remove("hidden");
      return;
    }

    try {
      const oldSaltUint8 = hexToBuf(meta.saltHex);
      const testVerifier = await computePasswordVerifier(oldPass, oldSaltUint8);
      if (testVerifier !== meta.verifier) {
        vaultChangePassError.textContent = "Current master password is incorrect.";
        vaultChangePassError.classList.remove("hidden");
        return;
      }

      // Generate new salt and key
      const newSalt = crypto.getRandomValues(new Uint8Array(16));
      const newSaltHex = bufToHex(newSalt);
      const newKey = await deriveVaultKey(newPass, newSalt);
      const newVerifier = await computePasswordVerifier(newPass, newSalt);

      // Re-encrypt contacts with new key
      const encResult = await encryptVaultPayload(JSON.stringify(vaultState.contacts), newKey);

      saveVaultMeta({
        saltHex: newSaltHex,
        verifier: newVerifier,
        lastIv: encResult.ivHex,
        updatedAt: new Date().toISOString()
      });
      localStorage.setItem("letschat_vault_data", encResult.dataB64);

      vaultState.key = newKey;
      vaultState.saltHex = newSaltHex;

      vaultChangePassCard.classList.add("hidden");
      vaultChangePassForm.reset();
      vaultChangePassError.classList.add("hidden");

      showToast("Vault master password changed successfully!", "success");
      resetAutoLock();
    } catch (err) {
      console.error("Change pass error:", err);
      vaultChangePassError.textContent = "Failed to update password. Please try again.";
      vaultChangePassError.classList.remove("hidden");
    }
  });

  // --- SEARCH FILTER ---
  vaultSearchInput.addEventListener("input", (e) => {
    renderVaultContacts(e.target.value.trim());
    resetAutoLock();
  });

  // --- PASSWORD VISIBILITY TOGGLES (SVG EYE TOGGLE) ---
  function resetPasswordToggles(container = document) {
    container.querySelectorAll(".password-group").forEach((group) => {
      const input = group.querySelector("input");
      const btn = group.querySelector(".password-toggle-btn");
      if (input && input.type === "text") {
        input.type = "password";
      }
      if (btn) {
        const eyeOpen = btn.querySelector(".eye-open");
        const eyeClosed = btn.querySelector(".eye-closed");
        if (eyeOpen && eyeClosed) {
          eyeOpen.classList.remove("hidden");
          eyeClosed.classList.add("hidden");
        }
        btn.setAttribute("title", "Show password");
        btn.setAttribute("aria-label", "Show password");
      }
    });
  }

  document.querySelectorAll(".password-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute("data-target");
      if (!targetId) return;
      const input = document.getElementById(targetId);
      if (!input) return;

      const isPassword = input.type === "password";
      input.type = isPassword ? "text" : "password";

      const eyeOpen = btn.querySelector(".eye-open");
      const eyeClosed = btn.querySelector(".eye-closed");
      if (eyeOpen && eyeClosed) {
        if (isPassword) {
          // Password now visible
          eyeOpen.classList.add("hidden");
          eyeClosed.classList.remove("hidden");
          btn.setAttribute("title", "Hide password");
          btn.setAttribute("aria-label", "Hide password");
        } else {
          // Password now hidden
          eyeOpen.classList.remove("hidden");
          eyeClosed.classList.add("hidden");
          btn.setAttribute("title", "Show password");
          btn.setAttribute("aria-label", "Show password");
        }
      }
      input.focus();
    });
  });

  // --- INITIALIZE THEME & SOUND ---
  applyTheme(state.theme);
  setSoundEnabled(state.soundEnabled);
  refreshVaultView();
})();

