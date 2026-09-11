import crypto from "crypto";
import { Server, Socket } from "socket.io";
import { CONFIG } from "./config";
import { db, DbMessage } from "./database";

// Character set for human-readable codes, excluding easily confused characters (0, O, 1, I)
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateCryptoCode(length = 8): string {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let i = 0; i < length; i++) {
    result += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  // Format as XXXX-XXXX if length is 8
  if (length === 8) {
    return `${result.substring(0, 4)}-${result.substring(4, 8)}`;
  }
  return result;
}

export function generateSecretKey(): string {
  return crypto.randomBytes(24).toString("hex");
}

export function isValidPermanentCode(code?: string | null): boolean {
  if (!code || typeof code !== "string") return false;
  const cleaned = code.trim().toUpperCase();
  // Must be 8 characters from CODE_ALPHABET, optionally hyphenated in the middle
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-?[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(cleaned);
}

export function sanitizeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export type ConnectionState = "OFFLINE" | "WAITING" | "TEMPORARY_INTRO" | "FULLY_CONNECTED";
export type ChatMode = "NORMAL" | "PRIVATE";

export interface EphemeralMessage {
  id: string;
  senderId: string;
  senderCode: string;
  senderName?: string | null;
  text: string;
  timestamp: number;
  replyTo: string | null;
  mode: "intro" | "private";
  deleted: boolean;
}

export interface IntroductionSession {
  id: string;
  userAId: string;
  userBId: string;
  socketAId: string;
  socketBId: string;
  tokenA: string;
  tokenB: string;
  tokenACommitted: boolean;
  tokenBCommitted: boolean;
  userAVerifiedPartner: boolean;
  userBVerifiedPartner: boolean;
  tokenAConsumed: boolean;
  tokenBConsumed: boolean;
  expiresAt: number;
  timer: NodeJS.Timeout | null;
  isCompleting?: boolean;
}

export interface PendingPairRequest {
  id: string;
  requesterSocketId: string;
  requesterUserId: string;
  requesterCode: string;
  requesterDisplayName: string | null;
  targetCode: string;
  createdAt: number;
  expiresAt: number;
  timer: NodeJS.Timeout | null;
}

export interface ActiveSession {
  socketId: string;
  userId: string;
  permanentCode: string;
  recoveryKey: string;
  displayName: string | null;
  state: ConnectionState;
  mode: ChatMode;
  partnerSocketId: string | null;
  partnerUserId: string | null;
  partnerPermanentCode: string | null;
  partnerDisplayName: string | null;
  temporaryToken: string | null;
  introductionId: string | null;
  introExpiresAt: number | null;
  introTimer: NodeJS.Timeout | null;
  handshakeVerified: boolean;
  conversationId: string | null;
  pendingPrivateRequest: boolean;
  pendingPrivateRequestId: string | null;
  privateRequestTimer: NodeJS.Timeout | null;
  pairingAttempts: number[];
  messageCount: number[];
  handshakeAttempts: number[];
  privateRequestAttempts: number[];
}

export class PairingManager {
  private io: Server;
  // socketId -> ActiveSession
  private sessions = new Map<string, ActiveSession>();
  // userId -> socketId
  private userToSocket = new Map<string, string>();
  // Active temporary introduction sessions: introId -> IntroductionSession
  private introductions = new Map<string, IntroductionSession>();
  // Ephemeral intro messages: pairingKey -> EphemeralMessage[]
  private introMessages = new Map<string, EphemeralMessage[]>();
  // Ephemeral private messages: pairingKey -> EphemeralMessage[]
  private privateMessages = new Map<string, EphemeralMessage[]>();
  // Active pending pair requests waiting up to 2 minutes for mutual code: requesterCode -> PendingPairRequest
  private pendingPairRequests = new Map<string, PendingPairRequest>();

  constructor(io: Server) {
    this.io = io;
  }

  private getPairingKey(idA: string, idB: string): string {
    return [idA, idB].sort().join("::");
  }

  public async registerSocket(
    socket: Socket,
    permanentCode?: string,
    recoveryKey?: string,
    initialDisplayName?: string
  ): Promise<{ user: { id: string; permanentCode: string; recoveryKey: string; displayName: string | null }; isNew: boolean }> {
    let user = null;
    let isNew = false;

    // Validate format of permanentCode before querying database
    if (permanentCode && recoveryKey && isValidPermanentCode(permanentCode)) {
      user = await db.getUserByCodeAndKey(permanentCode, recoveryKey);
    }

    if (!user) {
      // Generate a brand new unique permanent code
      let newCode = "";
      let attempts = 0;
      do {
        newCode = generateCryptoCode(8);
        attempts++;
      } while ((await db.getUserByPermanentCode(newCode)) !== null && attempts < 15);

      const newUserId = "usr_" + crypto.randomBytes(8).toString("hex");
      const newRecoveryKey = generateSecretKey();
      const cleanInitial = initialDisplayName ? initialDisplayName.trim().substring(0, 24) : null;
      user = await db.createUser(newUserId, newCode, newRecoveryKey, cleanInitial);
      isNew = true;
      console.log(`[Pairing] Created new user with permanent code: ${newCode}`);
    } else {
      console.log(`[Pairing] Recovered returning user with permanent code: ${user.permanent_code}`);
      if (initialDisplayName && !user.display_name) {
        const cleanInitial = initialDisplayName.trim().substring(0, 24);
        await db.updateUserName(user.id, cleanInitial);
        user.display_name = cleanInitial;
      }
    }

    // Disconnect old socket if this user was already connected in another tab
    const oldSocketId = this.userToSocket.get(user.id);
    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSession = this.sessions.get(oldSocketId);
      if (oldSession) {
        this.endSession(oldSocketId, "You opened a new session in another window.");
      }
    }

    const session: ActiveSession = {
      socketId: socket.id,
      userId: user.id,
      permanentCode: user.permanent_code,
      recoveryKey: user.recovery_key,
      displayName: user.display_name || null,
      state: "WAITING",
      mode: "NORMAL",
      partnerSocketId: null,
      partnerUserId: null,
      partnerPermanentCode: null,
      partnerDisplayName: null,
      temporaryToken: null,
      introductionId: null,
      introExpiresAt: null,
      introTimer: null,
      handshakeVerified: false,
      conversationId: null,
      pendingPrivateRequest: false,
      pendingPrivateRequestId: null,
      privateRequestTimer: null,
      pairingAttempts: [],
      messageCount: [],
      handshakeAttempts: [],
      privateRequestAttempts: []
    };

    this.sessions.set(socket.id, session);
    this.userToSocket.set(user.id, socket.id);

    // If another user has an active pending pair request waiting for this user's code, notify this user!
    for (const pending of this.pendingPairRequests.values()) {
      if (pending.targetCode === user.permanent_code && pending.expiresAt > Date.now()) {
        socket.emit("incoming-pairing-request", {
          requesterCode: pending.requesterCode,
          requesterDisplayName: pending.requesterDisplayName || "Partner",
          expiresAt: pending.expiresAt
        });
      }
    }

    return {
      user: {
        id: user.id,
        permanentCode: user.permanent_code,
        recoveryKey: user.recovery_key,
        displayName: user.display_name || null
      },
      isNew
    };
  }

  public async updateDisplayName(
    socketId: string,
    rawName: string
  ): Promise<{ success: boolean; displayName: string; error?: string }> {
    const session = this.sessions.get(socketId);
    if (!session) return { success: false, displayName: "", error: "Session not found." };

    const clean = (rawName || "").trim().substring(0, 24);
    session.displayName = clean || null;
    await db.updateUserName(session.userId, clean || null);

    // If connected to a partner, notify them immediately
    if (session.partnerSocketId) {
      const partnerSession = this.sessions.get(session.partnerSocketId);
      if (partnerSession) {
        partnerSession.partnerDisplayName = clean || null;
      }
      this.io.to(session.partnerSocketId).emit("partner-name-updated", {
        displayName: clean || null,
        partnerCode: session.permanentCode
      });
    }

    return { success: true, displayName: clean };
  }

  public getSession(socketId: string): ActiveSession | undefined {
    return this.sessions.get(socketId);
  }

  public async handlePairRequest(
    requesterSocketId: string,
    targetCodeRaw: string
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(requesterSocketId);
    if (!session) return { success: false, error: "Session not found." };

    // Rate limiting for pairing attempts
    const now = Date.now();
    session.pairingAttempts = session.pairingAttempts.filter(
      (ts) => now - ts < CONFIG.RATE_LIMIT_PAIRING_WINDOW_MS
    );
    if (session.pairingAttempts.length >= CONFIG.RATE_LIMIT_PAIRING_MAX) {
      return {
        success: false,
        error: "Too many pairing attempts. Please wait a moment and try again."
      };
    }
    session.pairingAttempts.push(now);

    const targetCode = targetCodeRaw ? targetCodeRaw.trim().toUpperCase() : "";

    if (!isValidPermanentCode(targetCode)) {
      return { success: false, error: "Please enter a valid permanent code format (e.g. AX7K-42PQ)." };
    }

    // Cannot connect to self
    if (targetCode === session.permanentCode) {
      return { success: false, error: "You cannot connect to your own code." };
    }

    // Already in active connection
    if (session.state === "TEMPORARY_INTRO" || session.state === "FULLY_CONNECTED") {
      return { success: false, error: "You are already in an active session." };
    }

    // Check if target code user already has an active pending pair request waiting for THIS user's code!
    const reciprocalRequest = this.pendingPairRequests.get(targetCode);
    if (reciprocalRequest && reciprocalRequest.targetCode === session.permanentCode) {
      console.log(`[Pairing] Mutual code match between ${session.permanentCode} and ${targetCode}!`);
      if (reciprocalRequest.timer) clearTimeout(reciprocalRequest.timer);
      this.pendingPairRequests.delete(targetCode);
      this.cancelPendingPairRequest(session.permanentCode, false);

      const targetSession = this.sessions.get(reciprocalRequest.requesterSocketId);
      if (targetSession && targetSession.state === "WAITING") {
        this.startTemporaryIntroduction(session, targetSession);
        return { success: true };
      }
    }

    // Check if target user is currently online and in another conversation
    const targetUser = await db.getUserByPermanentCode(targetCode);
    const targetSocketId = targetUser ? this.userToSocket.get(targetUser.id) : null;
    const targetSession = targetSocketId ? this.sessions.get(targetSocketId) : null;

    if (targetSession && (targetSession.state === "TEMPORARY_INTRO" || targetSession.state === "FULLY_CONNECTED")) {
      return { success: false, error: "That user is currently busy in another active session." };
    }

    // Clear any previous pending request by this requester
    this.cancelPendingPairRequest(session.permanentCode, false);

    // Enter 2-minute (120 seconds) pending waiting window
    const durationMs = CONFIG.PAIRING_WAIT_TIMEOUT;
    const expiresAt = Date.now() + durationMs;
    const requestId = "preq_" + crypto.randomUUID();

    const timer = setTimeout(() => {
      this.handlePairRequestTimeout(session.permanentCode);
    }, durationMs);

    const pendingReq: PendingPairRequest = {
      id: requestId,
      requesterSocketId: session.socketId,
      requesterUserId: session.userId,
      requesterCode: session.permanentCode,
      requesterDisplayName: session.displayName,
      targetCode: targetCode,
      createdAt: Date.now(),
      expiresAt,
      timer
    };

    this.pendingPairRequests.set(session.permanentCode, pendingReq);

    // Emit waiting state to requester
    this.io.to(session.socketId).emit("pairing-waiting", {
      targetCode,
      myCode: session.permanentCode,
      expiresAt,
      durationMs
    });

    // If target user is currently online, notify them immediately!
    if (targetSocketId) {
      this.io.to(targetSocketId).emit("incoming-pairing-request", {
        requesterCode: session.permanentCode,
        requesterDisplayName: session.displayName || "Partner",
        expiresAt
      });
    }

    console.log(`[Pairing] User ${session.permanentCode} is waiting 2 minutes for ${targetCode}`);
    return { success: true };
  }

  public cancelPendingPairRequest(requesterCode: string, notify = true): void {
    const req = this.pendingPairRequests.get(requesterCode);
    if (!req) return;

    if (req.timer) {
      clearTimeout(req.timer);
    }
    this.pendingPairRequests.delete(requesterCode);

    if (notify) {
      this.io.to(req.requesterSocketId).emit("pairing-cancelled", {
        targetCode: req.targetCode
      });
    }

    // Also notify target user if online that request was cancelled
    for (const s of this.sessions.values()) {
      if (s.permanentCode === req.targetCode) {
        this.io.to(s.socketId).emit("incoming-pairing-cancelled", {
          requesterCode: req.requesterCode
        });
      }
    }
  }

  private handlePairRequestTimeout(requesterCode: string): void {
    const req = this.pendingPairRequests.get(requesterCode);
    if (!req) return;

    this.pendingPairRequests.delete(requesterCode);

    this.io.to(req.requesterSocketId).emit("pairing-timeout", {
      targetCode: req.targetCode,
      myCode: req.requesterCode,
      message: "Waiting time expired (2 minutes). The other user did not enter your code in time."
    });

    console.log(`[Pairing] Pairing request from ${requesterCode} to ${req.targetCode} timed out after 2 minutes.`);
  }

  private startTemporaryIntroduction(sessionA: ActiveSession, sessionB: ActiveSession): void {
    const pairingKey = this.getPairingKey(sessionA.userId, sessionB.userId);
    this.introMessages.set(pairingKey, []);

    // Generate cryptographically secure tokens bound to this introduction session
    const introId = "intro_" + crypto.randomUUID();
    const tokenA = crypto.randomBytes(16).toString("hex");
    const tokenB = crypto.randomBytes(16).toString("hex");
    const expiresAt = Date.now() + CONFIG.INTRODUCTION_TIMEOUT;

    // Create Introduction Session tracking object
    const introSession: IntroductionSession = {
      id: introId,
      userAId: sessionA.userId,
      userBId: sessionB.userId,
      socketAId: sessionA.socketId,
      socketBId: sessionB.socketId,
      tokenA,
      tokenB,
      tokenACommitted: false,
      tokenBCommitted: false,
      userAVerifiedPartner: false,
      userBVerifiedPartner: false,
      tokenAConsumed: false,
      tokenBConsumed: false,
      expiresAt,
      timer: null
    };

    // Configure Session A
    sessionA.state = "TEMPORARY_INTRO";
    sessionA.mode = "NORMAL";
    sessionA.partnerSocketId = sessionB.socketId;
    sessionA.partnerUserId = sessionB.userId;
    sessionA.partnerPermanentCode = sessionB.permanentCode;
    sessionA.partnerDisplayName = sessionB.displayName;
    sessionA.temporaryToken = tokenA;
    sessionA.introductionId = introId;
    sessionA.introExpiresAt = expiresAt;
    sessionA.handshakeVerified = false;

    // Configure Session B
    sessionB.state = "TEMPORARY_INTRO";
    sessionB.mode = "NORMAL";
    sessionB.partnerSocketId = sessionA.socketId;
    sessionB.partnerUserId = sessionA.userId;
    sessionB.partnerPermanentCode = sessionA.permanentCode;
    sessionB.partnerDisplayName = sessionA.displayName;
    sessionB.temporaryToken = tokenB;
    sessionB.introductionId = introId;
    sessionB.introExpiresAt = expiresAt;
    sessionB.handshakeVerified = false;

    // Set timer for introduction expiration (strict 90-second timeout)
    introSession.timer = setTimeout(() => {
      this.handleIntroductionTimeout(introId);
    }, CONFIG.INTRODUCTION_TIMEOUT);

    this.introductions.set(introId, introSession);
    sessionA.introTimer = introSession.timer;
    sessionB.introTimer = introSession.timer;

    // Notify both clients of temporary introduction
    // CRITICAL SECURITY: neither client receives the partner's token yet.
    // The tokens must be genuinely exchanged and cross-verified through the connection!
    this.io.to(sessionA.socketId).emit("introduction-start", {
      introductionId: introId,
      partnerCode: sessionB.permanentCode,
      partnerDisplayName: sessionB.displayName || null,
      myTemporaryToken: tokenA,
      partnerTemporaryToken: null,
      timeRemainingMs: CONFIG.INTRODUCTION_TIMEOUT,
      expiresAt: expiresAt
    });

    this.io.to(sessionB.socketId).emit("introduction-start", {
      introductionId: introId,
      partnerCode: sessionA.permanentCode,
      partnerDisplayName: sessionA.displayName || null,
      myTemporaryToken: tokenB,
      partnerTemporaryToken: null,
      timeRemainingMs: CONFIG.INTRODUCTION_TIMEOUT,
      expiresAt: expiresAt
    });

    console.log(
      `[Pairing] Temporary introduction ${introId} started between ${sessionA.permanentCode} and ${sessionB.permanentCode}`
    );
  }

  private handleIntroductionTimeout(introId: string): void {
    const intro = this.introductions.get(introId);
    if (!intro) return;

    console.log(`[Pairing] Temporary introduction ${introId} timed out after ${CONFIG.INTRODUCTION_TIMEOUT / 1000}s`);

    // Invalidate tokens and destroy intro state
    this.introductions.delete(introId);

    const sessionA = this.sessions.get(intro.socketAId);
    const sessionB = this.sessions.get(intro.socketBId);

    if (sessionA && sessionA.state === "TEMPORARY_INTRO") {
      this.io.to(sessionA.socketId).emit("introduction-expired", {
        message: "The 90-second temporary connection expired."
      });
      this.resetToWaiting(sessionA);
    }

    if (sessionB && sessionB.state === "TEMPORARY_INTRO") {
      this.io.to(sessionB.socketId).emit("introduction-expired", {
        message: "The 90-second temporary connection expired."
      });
      this.resetToWaiting(sessionB);
    }

    const pairingKey = this.getPairingKey(intro.userAId, intro.userBId);
    this.introMessages.delete(pairingKey);
  }

  /**
   * Cryptographic Token Exchange & Cross-Verification
   *
   * Flow:
   * 1. User commits their own temporary token via `submit-handshake-token` or `complete-handshake`.
   *    Server validates that it matches their assigned credential for the active introduction.
   *    Server relays that credential to the partner over the connection.
   * 2. When partner token is presented, server verifies that it matches the OTHER participant's credential,
   *    confirming authentic cross-session verification.
   * 3. Once BOTH users have cross-verified the other's token:
   *    - Tokens are marked consumed and destroyed.
   *    - Both are promoted to FULLY_CONNECTED.
   *    - A stable PostgreSQL conversation is retrieved/created via ON CONFLICT.
   */
  public async completeHandshake(
    socketId: string,
    data?: { introductionId?: string; token?: string; partnerToken?: string }
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(socketId);
    if (!session) {
      return { success: false, error: "Session not found." };
    }

    // If session is already promoted to FULLY_CONNECTED, consider handshake complete
    if (session.state === "FULLY_CONNECTED") {
      return { success: true };
    }

    if (session.state !== "TEMPORARY_INTRO" || !session.partnerSocketId || !session.introductionId) {
      return { success: false, error: "No active temporary introduction to verify." };
    }

    // Rate limiting for handshake submissions
    const now = Date.now();
    session.handshakeAttempts = session.handshakeAttempts.filter(
      (ts) => now - ts < CONFIG.RATE_LIMIT_HANDSHAKE_WINDOW_MS
    );
    if (session.handshakeAttempts.length >= CONFIG.RATE_LIMIT_HANDSHAKE_MAX) {
      return { success: false, error: "Too many handshake attempts. Please wait a moment." };
    }
    session.handshakeAttempts.push(now);

    const intro = this.introductions.get(session.introductionId);
    if (!intro || Date.now() >= intro.expiresAt || intro.tokenAConsumed || intro.tokenBConsumed) {
      return { success: false, error: "Temporary introduction has expired or is no longer valid." };
    }

    if (data?.introductionId && data.introductionId !== intro.id) {
      return { success: false, error: "Temporary introduction ID mismatch." };
    }

    const partnerSession = this.sessions.get(session.partnerSocketId);
    if (!partnerSession || partnerSession.partnerSocketId !== socketId) {
      return { success: false, error: "Partner session is no longer available." };
    }

    // Determine participant strictly from socket.id and server IntroductionSession
    const isUserA = socketId === intro.socketAId;
    const isUserB = socketId === intro.socketBId;
    if (!isUserA && !isUserB) {
      return { success: false, error: "Unauthorized session participant." };
    }

    // 1. Committing own token
    if (data?.token) {
      const expectedOwnToken = isUserA ? intro.tokenA : intro.tokenB;
      if (data.token !== expectedOwnToken) {
        return { success: false, error: "Invalid temporary session token." };
      }

      if (isUserA) {
        const newlyCommitted = !intro.tokenACommitted;
        intro.tokenACommitted = true;
        // Relay Token A to User B over the temporary connection ONLY once
        if (newlyCommitted) {
          this.io.to(intro.socketBId).emit("partner-token-exchanged", {
            introductionId: intro.id,
            partnerTemporaryToken: intro.tokenA
          });
        }
        this.io.to(intro.socketAId).emit("token-committed", {
          introductionId: intro.id,
          partnerTemporaryToken: intro.tokenBCommitted ? intro.tokenB : null
        });
      } else {
        const newlyCommitted = !intro.tokenBCommitted;
        intro.tokenBCommitted = true;
        // Relay Token B to User A over the temporary connection ONLY once
        if (newlyCommitted) {
          this.io.to(intro.socketAId).emit("partner-token-exchanged", {
            introductionId: intro.id,
            partnerTemporaryToken: intro.tokenB
          });
        }
        this.io.to(intro.socketBId).emit("token-committed", {
          introductionId: intro.id,
          partnerTemporaryToken: intro.tokenACommitted ? intro.tokenA : null
        });
      }
    }

    // 2. Cross-verifying partner token
    if (data?.partnerToken) {
      const ownToken = isUserA ? intro.tokenA : intro.tokenB;
      const expectedPartnerToken = isUserA ? intro.tokenB : intro.tokenA;
      const partnerCommitted = isUserA ? intro.tokenBCommitted : intro.tokenACommitted;

      // Reject if user submits their own token as the partner token
      if (data.partnerToken === ownToken) {
        return { success: false, error: "Cannot submit your own token as the partner token." };
      }

      if (!partnerCommitted) {
        return { success: false, error: "Partner has not yet submitted their credential for exchange." };
      }

      if (data.partnerToken !== expectedPartnerToken) {
        return { success: false, error: "Partner token cross-verification failed: invalid token." };
      }

      if (isUserA) {
        // ONLY User A's verification flag changes. NEVER set intro.userBVerifiedPartner = true here!
        intro.userAVerifiedPartner = true;
        this.io.to(intro.socketAId).emit("partner-token-verified", { introductionId: intro.id });
      } else {
        // ONLY User B's verification flag changes. NEVER set intro.userAVerifiedPartner = true here!
        intro.userBVerifiedPartner = true;
        this.io.to(intro.socketBId).emit("partner-token-verified", { introductionId: intro.id });
      }
    }

    // 3. True Two-Sided Completion Check
    // The ONLY valid completion condition is:
    // tokenACommitted === true && tokenBCommitted === true && userAVerifiedPartner === true && userBVerifiedPartner === true
    if (
      intro.tokenACommitted === true &&
      intro.tokenBCommitted === true &&
      intro.userAVerifiedPartner === true &&
      intro.userBVerifiedPartner === true
    ) {
      // Concurrency guard: Ensure single, atomic execution even if both calls arrive concurrently
      if (intro.isCompleting) {
        return { success: true };
      }
      intro.isCompleting = true;
      intro.tokenAConsumed = true;
      intro.tokenBConsumed = true;

      if (intro.timer) {
        clearTimeout(intro.timer);
        intro.timer = null;
      }

      // Immediately delete from introductions to prevent replay
      this.introductions.delete(intro.id);

      session.state = "FULLY_CONNECTED";
      session.handshakeVerified = true;
      session.partnerDisplayName = partnerSession.displayName;
      session.temporaryToken = null;
      session.introductionId = null;
      session.introTimer = null;

      partnerSession.state = "FULLY_CONNECTED";
      partnerSession.handshakeVerified = true;
      partnerSession.partnerDisplayName = session.displayName;
      partnerSession.temporaryToken = null;
      partnerSession.introductionId = null;
      partnerSession.introTimer = null;

      // Retrieve or create stable, race-safe conversation in PostgreSQL
      const conversation = await db.getOrCreateConversation(session.userId, partnerSession.userId);
      session.conversationId = conversation.id;
      partnerSession.conversationId = conversation.id;

      // Load conversation history from PostgreSQL
      const history = await db.getConversationMessages(conversation.id, CONFIG.HISTORY_LIMIT);

      // Clean up ephemeral intro messages
      const pairingKey = this.getPairingKey(session.userId, partnerSession.userId);
      this.introMessages.delete(pairingKey);

      // Emit full session start to both clients
      this.io.to(session.socketId).emit("full-session-start", {
        partnerCode: partnerSession.permanentCode,
        partnerDisplayName: partnerSession.displayName || null,
        conversationId: conversation.id,
        history: history
      });

      this.io.to(partnerSession.socketId).emit("full-session-start", {
        partnerCode: session.permanentCode,
        partnerDisplayName: session.displayName || null,
        conversationId: conversation.id,
        history: history
      });

      console.log(
        `[Pairing] Both users mutually verified credentials! Full Live Session started between ${session.permanentCode} and ${partnerSession.permanentCode}`
      );
    }

    return { success: true };
  }

  public async handleSendMessage(
    socketId: string,
    rawText: string,
    replyToId?: string
  ): Promise<{ success: boolean; error?: string; isCommand?: boolean }> {
    const session = this.sessions.get(socketId);
    if (!session || (session.state !== "TEMPORARY_INTRO" && session.state !== "FULLY_CONNECTED")) {
      return { success: false, error: "You are not connected to any active session." };
    }

    const partnerSession = session.partnerSocketId ? this.sessions.get(session.partnerSocketId) : null;
    if (!partnerSession) {
      return { success: false, error: "Partner is disconnected." };
    }

    if (typeof rawText !== "string") {
      return { success: false, error: "Invalid message payload." };
    }

    const trimmed = rawText.trim();
    if (!trimmed) {
      return { success: false, error: "Message cannot be empty." };
    }

    // Check for Secret Private Command (/private)
    if (trimmed === CONFIG.PRIVATE_MODE_COMMAND) {
      if (session.state !== "FULLY_CONNECTED") {
        return {
          success: false,
          error: "Private mode request is only available during full connection."
        };
      }
      const canRequest = this.initiatePrivateModeRequest(session, partnerSession);
      if (!canRequest.success) {
        return { success: false, error: canRequest.error };
      }
      return { success: true, isCommand: true };
    }

    if (trimmed.length > CONFIG.MAX_MESSAGE_LENGTH) {
      return {
        success: false,
        error: `Message exceeds maximum length of ${CONFIG.MAX_MESSAGE_LENGTH} characters.`
      };
    }

    // Rate limiting for messages
    const now = Date.now();
    session.messageCount = session.messageCount.filter(
      (ts) => now - ts < CONFIG.RATE_LIMIT_MESSAGE_WINDOW_MS
    );
    if (session.messageCount.length >= CONFIG.RATE_LIMIT_MESSAGE_MAX) {
      return { success: false, error: "You are sending messages too quickly." };
    }
    session.messageCount.push(now);

    const safeText = sanitizeText(trimmed);
    const messageId = "msg_" + crypto.randomBytes(8).toString("hex") + "_" + now.toString(36);

    const pairingKey = this.getPairingKey(session.userId, partnerSession.userId);

    // Validate replyTo reference: must belong to the active conversation/session
    let validReplyTo: string | null = null;
    if (replyToId && typeof replyToId === "string") {
      const cleanReplyId = replyToId.trim();
      if (session.state === "TEMPORARY_INTRO") {
        const list = this.introMessages.get(pairingKey) || [];
        if (list.some((m) => m.id === cleanReplyId)) {
          validReplyTo = cleanReplyId;
        }
      } else if (session.mode === "PRIVATE") {
        const list = this.privateMessages.get(pairingKey) || [];
        if (list.some((m) => m.id === cleanReplyId)) {
          validReplyTo = cleanReplyId;
        }
      } else if (session.conversationId) {
        const refMsg = await db.getMessageById(cleanReplyId);
        if (refMsg && refMsg.conversation_id === session.conversationId) {
          validReplyTo = cleanReplyId;
        }
      }
    }

    if (session.state === "TEMPORARY_INTRO") {
      // Ephemeral introduction message: NEVER saved to PostgreSQL
      const ephemeralMsg: EphemeralMessage = {
        id: messageId,
        senderId: session.userId,
        senderCode: session.permanentCode,
        senderName: session.displayName || null,
        text: safeText,
        timestamp: now,
        replyTo: validReplyTo,
        mode: "intro",
        deleted: false
      };

      const list = this.introMessages.get(pairingKey) || [];
      list.push(ephemeralMsg);
      this.introMessages.set(pairingKey, list);

      const payload = {
        id: messageId,
        senderId: session.userId,
        senderCode: session.permanentCode,
        senderName: session.displayName || null,
        text: safeText,
        timestamp: now,
        replyTo: validReplyTo,
        mode: "intro" as const,
        deleted: false
      };

      this.io.to(session.socketId).emit("receive-message", payload);
      this.io.to(partnerSession.socketId).emit("receive-message", payload);
      return { success: true };
    }

    // FULLY_CONNECTED mode
    if (session.mode === "PRIVATE") {
      // Ephemeral private mode message: NEVER saved to PostgreSQL
      const privateMsg: EphemeralMessage = {
        id: messageId,
        senderId: session.userId,
        senderCode: session.permanentCode,
        senderName: session.displayName || null,
        text: safeText,
        timestamp: now,
        replyTo: validReplyTo,
        mode: "private",
        deleted: false
      };

      const list = this.privateMessages.get(pairingKey) || [];
      list.push(privateMsg);
      this.privateMessages.set(pairingKey, list);

      const payload = {
        id: messageId,
        senderId: session.userId,
        senderCode: session.permanentCode,
        senderName: session.displayName || null,
        text: safeText,
        timestamp: now,
        replyTo: validReplyTo,
        mode: "private" as const,
        deleted: false
      };

      this.io.to(session.socketId).emit("receive-message", payload);
      this.io.to(partnerSession.socketId).emit("receive-message", payload);
      return { success: true };
    }

    // Normal full-connection message: persisted in PostgreSQL
    const inserted = await db.insertMessage({
      id: messageId,
      conversationId: session.conversationId!,
      senderId: session.userId,
      text: safeText,
      timestamp: now,
      replyTo: validReplyTo
    });

    const payload = {
      id: inserted.id,
      conversationId: inserted.conversation_id,
      senderId: inserted.sender_id,
      senderCode: session.permanentCode,
      senderName: session.displayName || null,
      text: inserted.text,
      timestamp: inserted.timestamp,
      replyTo: inserted.reply_to,
      mode: "normal" as const,
      deleted: false
    };

    this.io.to(session.socketId).emit("receive-message", payload);
    this.io.to(partnerSession.socketId).emit("receive-message", payload);
    return { success: true };
  }

  public async handleDeleteMessage(
    socketId: string,
    messageId: string
  ): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(socketId);
    if (!session) return { success: false, error: "Session not found." };

    if (!messageId || typeof messageId !== "string") {
      return { success: false, error: "Invalid message ID." };
    }

    const partnerSession = session.partnerSocketId ? this.sessions.get(session.partnerSocketId) : null;
    const pairingKey = partnerSession ? this.getPairingKey(session.userId, partnerSession.userId) : "";

    // 1. Check intro messages
    if (pairingKey && this.introMessages.has(pairingKey)) {
      const list = this.introMessages.get(pairingKey)!;
      const msg = list.find((m) => m.id === messageId);
      if (msg) {
        if (msg.senderId !== session.userId) {
          return { success: false, error: "You can only delete your own messages." };
        }
        msg.deleted = true;
        msg.text = "This message was deleted";
        this.broadcastDelete(session, partnerSession, messageId);
        return { success: true };
      }
    }

    // 2. Check private ephemeral messages
    if (pairingKey && this.privateMessages.has(pairingKey)) {
      const list = this.privateMessages.get(pairingKey)!;
      const msg = list.find((m) => m.id === messageId);
      if (msg) {
        if (msg.senderId !== session.userId) {
          return { success: false, error: "You can only delete your own messages." };
        }
        msg.deleted = true;
        msg.text = "This message was deleted";
        this.broadcastDelete(session, partnerSession, messageId);
        return { success: true };
      }
    }

    // 3. Check PostgreSQL messages
    const dbMsg = await db.getMessageById(messageId);
    if (!dbMsg) {
      return { success: false, error: "Message not found." };
    }

    if (dbMsg.sender_id !== session.userId) {
      return { success: false, error: "You can only delete your own messages." };
    }

    if (dbMsg.conversation_id !== session.conversationId) {
      return { success: false, error: "Message does not belong to this conversation." };
    }

    await db.markMessageDeleted(messageId);
    this.broadcastDelete(session, partnerSession, messageId);
    return { success: true };
  }

  private broadcastDelete(
    session: ActiveSession,
    partnerSession: ActiveSession | null,
    messageId: string
  ): void {
    const payload = {
      messageId,
      text: "This message was deleted"
    };
    this.io.to(session.socketId).emit("message-deleted", payload);
    if (partnerSession) {
      this.io.to(partnerSession.socketId).emit("message-deleted", payload);
    }
  }

  // PRIVATE MODE SECURITY & FLOW
  public initiatePrivateModeRequest(
    session: ActiveSession,
    partnerSession: ActiveSession
  ): { success: boolean; error?: string } {
    if (session.mode === "PRIVATE" || partnerSession.mode === "PRIVATE") {
      this.io.to(session.socketId).emit("system-notice", {
        message: "You are already in Private Mode."
      });
      return { success: false, error: "Already in Private Mode." };
    }

    if (session.pendingPrivateRequest) {
      this.io.to(session.socketId).emit("system-notice", {
        message: "A Private Mode request is already pending."
      });
      return { success: false, error: "Request already pending." };
    }

    // Rate limiting for private mode requests
    const now = Date.now();
    session.privateRequestAttempts = session.privateRequestAttempts.filter(
      (ts) => now - ts < CONFIG.RATE_LIMIT_PRIVATE_WINDOW_MS
    );
    if (session.privateRequestAttempts.length >= CONFIG.RATE_LIMIT_PRIVATE_MAX) {
      return { success: false, error: "Too many private mode requests. Please wait a moment." };
    }
    session.privateRequestAttempts.push(now);

    const requestId = "priv_req_" + crypto.randomUUID();
    session.pendingPrivateRequest = true;
    session.pendingPrivateRequestId = requestId;

    // Timeout for private request
    session.privateRequestTimer = setTimeout(() => {
      if (session.pendingPrivateRequest && session.pendingPrivateRequestId === requestId) {
        session.pendingPrivateRequest = false;
        session.pendingPrivateRequestId = null;
        this.io.to(session.socketId).emit("private-mode-declined", {
          message: "Private mode request timed out."
        });
        this.io.to(partnerSession.socketId).emit("private-mode-request-cancelled");
      }
    }, CONFIG.PRIVATE_REQUEST_TIMEOUT);

    // Notify requester: waiting
    const partnerName = partnerSession.displayName || "Stranger";
    this.io.to(session.socketId).emit("private-mode-pending", {
      message: `Waiting for ${partnerName}'s response...`
    });

    // Notify partner: modal with cryptographically secure requestId
    this.io.to(partnerSession.socketId).emit("private-mode-requested", {
      requestId,
      requesterCode: session.permanentCode,
      requesterName: session.displayName || "Stranger"
    });

    return { success: true };
  }

  public handlePrivateModeResponse(
    socketId: string,
    accept: boolean,
    requestId?: string
  ): { success: boolean; error?: string } {
    const session = this.sessions.get(socketId);
    if (!session || !session.partnerSocketId || session.state !== "FULLY_CONNECTED") {
      return { success: false, error: "Partner session not found." };
    }

    const requesterSession = this.sessions.get(session.partnerSocketId);
    if (!requesterSession || !requesterSession.pendingPrivateRequest) {
      return { success: false, error: "No pending private mode request." };
    }

    // Ensure only the intended participant responding to the matching requestId can accept
    if (requestId && requesterSession.pendingPrivateRequestId && requestId !== requesterSession.pendingPrivateRequestId) {
      return { success: false, error: "Invalid or expired private mode request ID." };
    }

    if (requesterSession.privateRequestTimer) {
      clearTimeout(requesterSession.privateRequestTimer);
      requesterSession.privateRequestTimer = null;
    }
    requesterSession.pendingPrivateRequest = false;
    requesterSession.pendingPrivateRequestId = null;

    if (!accept) {
      this.io.to(requesterSession.socketId).emit("private-mode-declined", {
        message: "Private mode request declined."
      });
      this.io.to(session.socketId).emit("system-notice", {
        message: "You declined private mode."
      });
      return { success: true };
    }

    // Both enter Ephemeral Private Mode
    session.mode = "PRIVATE";
    requesterSession.mode = "PRIVATE";

    const pairingKey = this.getPairingKey(session.userId, requesterSession.userId);
    this.privateMessages.set(pairingKey, []);

    this.io.to(session.socketId).emit("private-mode-start");
    this.io.to(requesterSession.socketId).emit("private-mode-start");

    console.log(
      `[Pairing] Private mode activated between ${session.permanentCode} and ${requesterSession.permanentCode}`
    );
    return { success: true };
  }

  public async handleLeavePrivateMode(socketId: string): Promise<{ success: boolean; error?: string }> {
    const session = this.sessions.get(socketId);
    if (!session || session.mode !== "PRIVATE" || !session.partnerSocketId) {
      return { success: false, error: "Not in private mode." };
    }

    const partnerSession = this.sessions.get(session.partnerSocketId);

    // Switch both back to normal
    session.mode = "NORMAL";
    if (partnerSession) {
      partnerSession.mode = "NORMAL";
    }

    // Wipe ephemeral private messages from memory immediately
    if (partnerSession) {
      const pairingKey = this.getPairingKey(session.userId, partnerSession.userId);
      this.privateMessages.delete(pairingKey);
    }

    // Load recent normal messages from PostgreSQL
    let normalHistory: DbMessage[] = [];
    if (session.conversationId) {
      normalHistory = await db.getConversationMessages(session.conversationId, CONFIG.HISTORY_LIMIT);
    }

    this.io.to(session.socketId).emit("private-mode-end", { history: normalHistory });
    if (partnerSession) {
      this.io.to(partnerSession.socketId).emit("private-mode-end", { history: normalHistory });
    }

    console.log(`[Pairing] Exited private mode for session ${session.permanentCode}`);
    return { success: true };
  }

  public endSession(socketId: string, reason = "The other user disconnected."): void {
    const session = this.sessions.get(socketId);
    if (!session) return;

    if (session.introTimer) {
      clearTimeout(session.introTimer);
      session.introTimer = null;
    }
    if (session.privateRequestTimer) {
      clearTimeout(session.privateRequestTimer);
      session.privateRequestTimer = null;
    }

    if (session.introductionId) {
      const intro = this.introductions.get(session.introductionId);
      if (intro && intro.timer) {
        clearTimeout(intro.timer);
      }
      this.introductions.delete(session.introductionId);
    }

    const partnerSocketId = session.partnerSocketId;
    if (partnerSocketId) {
      const partnerSession = this.sessions.get(partnerSocketId);
      if (partnerSession) {
        if (partnerSession.introTimer) {
          clearTimeout(partnerSession.introTimer);
          partnerSession.introTimer = null;
        }
        if (partnerSession.privateRequestTimer) {
          clearTimeout(partnerSession.privateRequestTimer);
          partnerSession.privateRequestTimer = null;
        }

        const pairingKey = this.getPairingKey(session.userId, partnerSession.userId);
        this.introMessages.delete(pairingKey);
        this.privateMessages.delete(pairingKey);

        this.resetToWaiting(partnerSession);
        this.io.to(partnerSocketId).emit("full-session-end", { reason });
      }
    }

    this.resetToWaiting(session);
    this.io.to(socketId).emit("full-session-end", { reason: "Session ended." });
  }

  public handleDisconnect(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (!session) return;

    console.log(`[Pairing] User ${session.permanentCode} disconnected (${socketId})`);

    this.cancelPendingPairRequest(session.permanentCode, false);

    // End active pairing and clean up ephemeral state immediately
    if (session.partnerSocketId) {
      this.endSession(socketId, "The other user disconnected.");
    } else if (session.introductionId) {
      const intro = this.introductions.get(session.introductionId);
      if (intro) {
        if (intro.timer) clearTimeout(intro.timer);
        this.introductions.delete(session.introductionId);
      }
    }

    this.userToSocket.delete(session.userId);
    this.sessions.delete(socketId);
  }

  private resetToWaiting(session: ActiveSession): void {
    session.state = "WAITING";
    session.mode = "NORMAL";
    session.partnerSocketId = null;
    session.partnerUserId = null;
    session.partnerPermanentCode = null;
    session.partnerDisplayName = null;
    session.temporaryToken = null;
    session.introductionId = null;
    session.introExpiresAt = null;
    session.introTimer = null;
    session.handshakeVerified = false;
    session.conversationId = null;
    session.pendingPrivateRequest = false;
    session.pendingPrivateRequestId = null;
    session.privateRequestTimer = null;
  }
}
