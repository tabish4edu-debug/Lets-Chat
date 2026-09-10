import crypto from "crypto";
import pg from "pg";
import { newDb } from "pg-mem";
import { CONFIG } from "./config";

const { Pool, types } = pg;

// Parse PostgreSQL BIGINT (int8) as JavaScript Number
types.setTypeParser(types.builtins.INT8, (val: string) => parseInt(val, 10));

export interface DbUser {
  id: string;
  permanent_code: string;
  recovery_key: string;
  display_name?: string | null;
  created_at: number;
}

export interface DbConversation {
  id: string;
  user_a: string;
  user_b: string;
  created_at: number;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  timestamp: number;
  reply_to: string | null;
  deleted: boolean;
}

class ChatDatabase {
  private pool: pg.Pool | null = null;
  private initialized = false;
  private inMemory = false;

  public get isInMemory(): boolean {
    return this.inMemory;
  }

  public async init(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl || !databaseUrl.trim()) {
      if (process.env.NODE_ENV === "production") {
        const errorMsg =
          "FATAL: Missing DATABASE_URL environment variable in production.\n" +
          "PostgreSQL is required for persistent storage.\n" +
          "Please configure DATABASE_URL in your hosting environment (e.g. Render).";
        console.error(errorMsg);
        throw new Error(errorMsg);
      }

      console.warn("\n==================================================================");
      console.warn("[PostgreSQL Database] NOTICE: DATABASE_URL environment variable is not set.");
      console.warn("For persistent cloud storage on Render, supply DATABASE_URL in your environment.");
      console.warn("Initializing in-memory PostgreSQL engine (pg-mem) for development/preview.");
      console.warn("(Zero SQLite used; pure PostgreSQL dialect via pg connection pool adapter)");
      console.warn("==================================================================\n");

      try {
        const memDb = newDb();
        const memPg = memDb.adapters.createPg();
        this.pool = new memPg.Pool() as unknown as pg.Pool;
        this.inMemory = true;

        await this.createTables();
        this.initialized = true;
        console.log("[PostgreSQL Database] In-memory PostgreSQL engine ready and tables verified.");
        return;
      } catch (memErr: any) {
        console.error("[PostgreSQL Database] Failed to initialize in-memory PostgreSQL:", memErr);
        throw memErr;
      }
    }

    // Determine SSL configuration for cloud hosted databases (Render, Supabase, Neon, etc.)
    const isLocalhost =
      databaseUrl.includes("localhost") ||
      databaseUrl.includes("127.0.0.1") ||
      databaseUrl.includes("sslmode=disable");

    const sslConfig = isLocalhost ? false : { rejectUnauthorized: false };

    try {
      this.pool = new Pool({
        connectionString: databaseUrl,
        ssl: sslConfig,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 10000
      });

      // Test connection
      await this.pool.query("SELECT 1 AS health_check");
      console.log("[PostgreSQL Database] PostgreSQL connection pool successfully established.");

      await this.createTables();
      this.initialized = true;
      console.log("[PostgreSQL Database] Tables and indexes verified successfully.");
    } catch (err: any) {
      console.error("\n==================================================================");
      console.error("[PostgreSQL Database] Failed to connect or initialize PostgreSQL tables:");
      console.error(err.message || err);
      console.error("==================================================================\n");
      throw err;
    }
  }

  private async createTables(): Promise<void> {
    if (!this.pool) throw new Error("Database pool not created.");

    // 1. Users table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        permanent_code VARCHAR(32) UNIQUE NOT NULL,
        recovery_key VARCHAR(64) NOT NULL,
        display_name VARCHAR(64),
        created_at BIGINT NOT NULL
      );
    `);

    // 2. Conversations table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS conversations (
        id VARCHAR(64) PRIMARY KEY,
        user_a VARCHAR(64) NOT NULL,
        user_b VARCHAR(64) NOT NULL,
        created_at BIGINT NOT NULL
      );
    `);

    // Add unique index on (user_a, user_b) to enforce database-level uniqueness
    await this.pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_user_a_user_b ON conversations(user_a, user_b);
    `);

    // 3. Messages table
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id VARCHAR(64) PRIMARY KEY,
        conversation_id VARCHAR(64) NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id VARCHAR(64) NOT NULL,
        text TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        reply_to VARCHAR(64),
        deleted BOOLEAN NOT NULL DEFAULT FALSE
      );
    `);

    // 4. Performance indexes
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_users_code ON users(permanent_code);
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_conversations_users ON conversations(user_a, user_b);
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
    `);
    await this.pool.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conv_time ON messages(conversation_id, timestamp ASC);
    `);
  }

  private ensurePool(): pg.Pool {
    if (!this.pool) {
      throw new Error(
        "Database is not initialized. Please ensure DATABASE_URL is set and init() completed."
      );
    }
    return this.pool;
  }

  public async createUser(
    id: string,
    permanentCode: string,
    recoveryKey: string,
    displayName?: string | null
  ): Promise<DbUser> {
    const pool = this.ensurePool();
    const createdAt = Date.now();
    const cleanName = displayName ? displayName.trim().substring(0, 64) : null;

    const res = await pool.query(
      `INSERT INTO users (id, permanent_code, recovery_key, display_name, created_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, permanent_code, recovery_key, display_name, created_at`,
      [id, permanentCode, recoveryKey, cleanName, createdAt]
    );

    const row = res.rows[0];
    return {
      id: row.id,
      permanent_code: row.permanent_code,
      recovery_key: row.recovery_key,
      display_name: row.display_name,
      created_at: Number(row.created_at)
    };
  }

  public async updateUserName(userId: string, displayName: string | null): Promise<void> {
    const pool = this.ensurePool();
    const cleanName = displayName ? displayName.trim().substring(0, 64) : null;
    await pool.query(
      `UPDATE users SET display_name = $1 WHERE id = $2`,
      [cleanName, userId]
    );
  }

  public async getUserByPermanentCode(code: string): Promise<DbUser | null> {
    const pool = this.ensurePool();
    const res = await pool.query(
      `SELECT id, permanent_code, recovery_key, display_name, created_at 
       FROM users 
       WHERE permanent_code = $1 
       LIMIT 1`,
      [code.toUpperCase().trim()]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      permanent_code: row.permanent_code,
      recovery_key: row.recovery_key,
      display_name: row.display_name,
      created_at: Number(row.created_at)
    };
  }

  public async getUserById(id: string): Promise<DbUser | null> {
    const pool = this.ensurePool();
    const res = await pool.query(
      `SELECT id, permanent_code, recovery_key, display_name, created_at 
       FROM users 
       WHERE id = $1 
       LIMIT 1`,
      [id]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      permanent_code: row.permanent_code,
      recovery_key: row.recovery_key,
      display_name: row.display_name,
      created_at: Number(row.created_at)
    };
  }

  public async getUserByCodeAndKey(code: string, recoveryKey: string): Promise<DbUser | null> {
    const pool = this.ensurePool();
    const res = await pool.query(
      `SELECT id, permanent_code, recovery_key, display_name, created_at 
       FROM users 
       WHERE permanent_code = $1 AND recovery_key = $2 
       LIMIT 1`,
      [code.toUpperCase().trim(), recoveryKey]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      permanent_code: row.permanent_code,
      recovery_key: row.recovery_key,
      display_name: row.display_name,
      created_at: Number(row.created_at)
    };
  }

  public async getOrCreateConversation(userAId: string, userBId: string): Promise<DbConversation> {
    const pool = this.ensurePool();

    // Canonical ordering: user_a < user_b strictly enforced
    const [first, second] = userAId < userBId ? [userAId, userBId] : [userBId, userAId];

    // Cryptographically secure conversation ID
    const convId = "conv_" + crypto.randomBytes(12).toString("hex");
    const createdAt = Date.now();

    // Race-safe insertion: if both users handshake concurrently, ON CONFLICT DO NOTHING ensures safety
    await pool.query(
      `INSERT INTO conversations (id, user_a, user_b, created_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_a, user_b) DO NOTHING`,
      [convId, first, second, createdAt]
    );

    // Retrieve the unique conversation (either newly inserted or existing)
    const res = await pool.query(
      `SELECT id, user_a, user_b, created_at 
       FROM conversations 
       WHERE user_a = $1 AND user_b = $2 
       LIMIT 1`,
      [first, second]
    );

    if (res.rows.length === 0) {
      throw new Error("Failed to create or retrieve stable conversation.");
    }

    const row = res.rows[0];
    return {
      id: row.id,
      user_a: row.user_a,
      user_b: row.user_b,
      created_at: Number(row.created_at)
    };
  }

  public async insertMessage(msg: {
    id: string;
    conversationId: string;
    senderId: string;
    text: string;
    timestamp: number;
    replyTo?: string | null;
  }): Promise<DbMessage> {
    const pool = this.ensurePool();

    const res = await pool.query(
      `INSERT INTO messages (id, conversation_id, sender_id, text, timestamp, reply_to, deleted)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE)
       RETURNING id, conversation_id, sender_id, text, timestamp, reply_to, deleted`,
      [msg.id, msg.conversationId, msg.senderId, msg.text, msg.timestamp, msg.replyTo || null]
    );

    // Limit stored history to CONFIG.HISTORY_LIMIT per conversation
    // Delete messages older than the most recent N messages
    await pool.query(
      `DELETE FROM messages 
       WHERE conversation_id = $1 AND id NOT IN (
         SELECT id FROM messages 
         WHERE conversation_id = $1 
         ORDER BY timestamp DESC 
         LIMIT $2
       )`,
      [msg.conversationId, CONFIG.HISTORY_LIMIT]
    );

    const row = res.rows[0];
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      sender_id: row.sender_id,
      text: row.text,
      timestamp: Number(row.timestamp),
      reply_to: row.reply_to,
      deleted: Boolean(row.deleted)
    };
  }

  public async getConversationMessages(
    conversationId: string,
    limit = CONFIG.HISTORY_LIMIT
  ): Promise<DbMessage[]> {
    const pool = this.ensurePool();

    const res = await pool.query(
      `SELECT id, conversation_id, sender_id, text, timestamp, reply_to, deleted 
       FROM messages 
       WHERE conversation_id = $1 
       ORDER BY timestamp ASC 
       LIMIT $2`,
      [conversationId, limit]
    );

    return res.rows.map((row) => ({
      id: row.id,
      conversation_id: row.conversation_id,
      sender_id: row.sender_id,
      text: row.text,
      timestamp: Number(row.timestamp),
      reply_to: row.reply_to,
      deleted: Boolean(row.deleted)
    }));
  }

  public async getMessageById(messageId: string): Promise<DbMessage | null> {
    const pool = this.ensurePool();

    const res = await pool.query(
      `SELECT id, conversation_id, sender_id, text, timestamp, reply_to, deleted 
       FROM messages 
       WHERE id = $1 
       LIMIT 1`,
      [messageId]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      conversation_id: row.conversation_id,
      sender_id: row.sender_id,
      text: row.text,
      timestamp: Number(row.timestamp),
      reply_to: row.reply_to,
      deleted: Boolean(row.deleted)
    };
  }

  public async markMessageDeleted(messageId: string): Promise<boolean> {
    const pool = this.ensurePool();

    await pool.query(
      `UPDATE messages SET deleted = TRUE, text = 'This message was deleted' WHERE id = $1`,
      [messageId]
    );
    return true;
  }

  public async close(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.initialized = false;
    }
  }
}

export const db = new ChatDatabase();
