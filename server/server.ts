import "dotenv/config";
import express from "express";
import fs from "fs";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { CONFIG } from "./config";
import { db } from "./database";
import { PairingManager } from "./pairing";

export async function startServer(): Promise<void> {
  const app = express();
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Initialize PostgreSQL database with connection pool and verify schema
  await db.init();

  const pairing = new PairingManager(io);

  app.use(express.json());

  // Serve static assets from public/ directory (robust path resolution for Render and local environments)
  let publicDir = path.join(process.cwd(), "public");
  if (!fs.existsSync(publicDir)) {
    publicDir = path.join(__dirname, "../public");
  }
  if (!fs.existsSync(publicDir)) {
    publicDir = path.join(__dirname, "public");
  }
  app.use(express.static(publicDir));

  // Health and config endpoints
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      database: "postgresql",
      databaseMode: db.isInMemory ? "in-memory" : "cloud",
      uptime: process.uptime(),
      timestamp: Date.now()
    });
  });

  app.get("/api/config", (_req, res) => {
    res.json({
      introductionTimeoutMs: CONFIG.INTRODUCTION_TIMEOUT,
      privateModeCommand: CONFIG.PRIVATE_MODE_COMMAND,
      maxMessageLength: CONFIG.MAX_MESSAGE_LENGTH,
      historyLimit: CONFIG.HISTORY_LIMIT
    });
  });

  // Fallback to index.html for SPA/vanilla routing
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  // Socket.IO event handling
  io.on("connection", (socket) => {
    console.log(`[Socket] Client connected: ${socket.id}`);

    // Registration and identity recovery
    socket.on(
      "register-session",
      async (data: { permanentCode?: string; recoveryKey?: string; displayName?: string } | undefined) => {
        try {
          const result = await pairing.registerSocket(
            socket,
            data?.permanentCode,
            data?.recoveryKey,
            data?.displayName
          );

          socket.emit("session-registered", {
            userId: result.user.id,
            permanentCode: result.user.permanentCode,
            recoveryKey: result.user.recoveryKey,
            displayName: result.user.displayName,
            isNew: result.isNew
          });
        } catch (err: any) {
          console.error("[Socket] Registration error:", err);
          socket.emit("system-error", { message: "Failed to initialize identity session." });
        }
      }
    );

    // Change / Update Display Name
    socket.on("update-display-name", async (data: { displayName: string }) => {
      try {
        const result = await pairing.updateDisplayName(socket.id, data?.displayName);
        socket.emit("display-name-updated", { displayName: result.displayName });
      } catch (err: any) {
        console.error("[Socket] Update display name error:", err);
        socket.emit("system-error", { message: "Failed to update display name." });
      }
    });

    // Pairing via Permanent Code
    socket.on("pair-with-permanent-code", async (data: { targetCode: string }) => {
      try {
        const result = await pairing.handlePairRequest(socket.id, data?.targetCode);
        if (!result.success) {
          socket.emit("pairing-failed", { message: result.error || "Pairing failed." });
        }
      } catch (err: any) {
        console.error("[Socket] Pairing error:", err);
        socket.emit("pairing-failed", { message: "Internal error during pairing." });
      }
    });

    // Cancel pending pairing request
    socket.on("cancel-pair-request", () => {
      try {
        const session = pairing.getSession(socket.id);
        if (session) {
          pairing.cancelPendingPairRequest(session.permanentCode);
        }
      } catch (err: any) {
        console.error("[Socket] Cancel pair request error:", err);
      }
    });

    // Temporary Token Handshake completion
    socket.on("complete-handshake", async (data?: { introductionId?: string; token?: string; partnerToken?: string }) => {
      try {
        const result = await pairing.completeHandshake(socket.id, data);
        if (!result.success) {
          socket.emit("handshake-failed", { message: result.error || "Handshake verification failed." });
        }
      } catch (err: any) {
        console.error("[Socket] Handshake error:", err);
      }
    });

    // Real-time Messaging
    socket.on("send-message", async (data: { text: string; replyTo?: string }) => {
      try {
        const result = await pairing.handleSendMessage(socket.id, data?.text, data?.replyTo);
        if (!result.success) {
          socket.emit("message-error", { message: result.error || "Failed to send message." });
        }
      } catch (err: any) {
        console.error("[Socket] Message send error:", err);
        socket.emit("message-error", { message: "Failed to process message." });
      }
    });

    // Delete message
    socket.on("delete-message", async (data: { messageId: string }) => {
      try {
        const result = await pairing.handleDeleteMessage(socket.id, data?.messageId);
        if (!result.success) {
          socket.emit("delete-error", { message: result.error || "Failed to delete message." });
        }
      } catch (err: any) {
        console.error("[Socket] Delete error:", err);
      }
    });

    // Typing Indicators (debounced by client)
    socket.on("typing", () => {
      const session = pairing.getSession(socket.id);
      if (session && session.partnerSocketId) {
        io.to(session.partnerSocketId).emit("partner-typing", {
          displayName: session.displayName || "Stranger"
        });
      }
    });

    socket.on("stopTyping", () => {
      const session = pairing.getSession(socket.id);
      if (session && session.partnerSocketId) {
        io.to(session.partnerSocketId).emit("partner-stopTyping");
      }
    });

    // Private Mode Response
    socket.on("private-mode-response", (data: { accept: boolean; requestId?: string }) => {
      try {
        pairing.handlePrivateModeResponse(socket.id, !!data?.accept, data?.requestId);
      } catch (err: any) {
        console.error("[Socket] Private mode response error:", err);
      }
    });

    // Leave Private Mode
    socket.on("leave-private-mode", async () => {
      try {
        await pairing.handleLeavePrivateMode(socket.id);
      } catch (err: any) {
        console.error("[Socket] Leave private mode error:", err);
      }
    });

    // End active session
    socket.on("end-session", () => {
      try {
        pairing.endSession(socket.id, "You ended the connection.");
      } catch (err: any) {
        console.error("[Socket] End session error:", err);
      }
    });

    // Disconnect
    socket.on("disconnect", () => {
      try {
        pairing.handleDisconnect(socket.id);
      } catch (err: any) {
        console.error("[Socket] Disconnect error:", err);
      }
    });
  });

  server.listen(CONFIG.PORT, "0.0.0.0", () => {
    console.log(`====================================================`);
    console.log(` Lets Chat running on port ${CONFIG.PORT}`);
    console.log(` Database: PostgreSQL (${process.env.DATABASE_URL ? "DATABASE_URL connected" : "none"})`);
    console.log(` Static folder: ${publicDir}`);
    console.log(` Intro timeout: ${CONFIG.INTRODUCTION_TIMEOUT / 1000}s`);
    console.log(` Private command: ${CONFIG.PRIVATE_MODE_COMMAND}`);
    console.log(`====================================================`);
  });
}
