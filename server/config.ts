/**
 * Central configuration for Token-Based Real-Time Chat
 */
export const CONFIG = {
  // Server port (defaults to 3000 in local dev; respects external PORT on Render / Cloud hosting)
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,

  // Temporary introduction connection duration in milliseconds (1 - 1.5 min)
  INTRODUCTION_TIMEOUT: 90 * 1000,

  // Duration to wait for partner to enter code during pairing (2 minutes = 120 seconds)
  PAIRING_WAIT_TIMEOUT: 120 * 1000,

  // Secret command to request private mode in the message input
  PRIVATE_MODE_COMMAND: "/private",

  // Maximum character length for a single message
  MAX_MESSAGE_LENGTH: 2000,

  // Maximum number of stored messages per conversation in PostgreSQL
  HISTORY_LIMIT: 100,

  // Rate limiting for pairing attempts per IP/socket
  RATE_LIMIT_PAIRING_MAX: 6,
  RATE_LIMIT_PAIRING_WINDOW_MS: 30 * 1000,

  // Rate limiting for messages
  RATE_LIMIT_MESSAGE_MAX: 15,
  RATE_LIMIT_MESSAGE_WINDOW_MS: 5 * 1000,

  // Rate limiting for handshake submissions
  RATE_LIMIT_HANDSHAKE_MAX: 10,
  RATE_LIMIT_HANDSHAKE_WINDOW_MS: 15 * 1000,

  // Rate limiting for private mode requests
  RATE_LIMIT_PRIVATE_MAX: 3,
  RATE_LIMIT_PRIVATE_WINDOW_MS: 30 * 1000,

  // Typing debounce timer in ms
  TYPING_DEBOUNCE_MS: 1500,

  // Private request timeout in ms
  PRIVATE_REQUEST_TIMEOUT: 45 * 1000
};
