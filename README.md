# Lets Chat - Token-Based Real-Time Chat

A secure, private real-time chat application with zero sign-ups, permanent user identity codes, verified temporary handshakes, ephemeral private mode, and persistent chat history backed by PostgreSQL.

---

## Architecture & Tech Stack

- **Backend**: Node.js, Express, Socket.IO
- **Database**: PostgreSQL (using `pg` connection pool with SSL support)
- **Frontend**: Vanilla JavaScript (`public/app.js`), HTML5 (`public/index.html`), modern CSS styling (`public/style.css`)
- **Deployment Target**: Render Free Web Service + Cloud PostgreSQL (Render Postgres, Supabase, Neon, or Railway)

---

## 1. How to Install Dependencies

Make sure you have [Node.js](https://nodejs.org/) (v18 or higher) installed on your system.

Clone the repository and install dependencies:

```bash
npm install
```

---

## 2. How to Create a PostgreSQL Database

You do not need PostgreSQL installed locally; you can use any cloud-hosted PostgreSQL database.

### Option A: Render PostgreSQL (Recommended for Render Deployment)
1. Log in to your [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** in the top navigation and select **PostgreSQL**.
3. Fill in:
   - **Name**: e.g., `letschat-db`
   - **Database**: `letschat`
   - **User**: (auto-generated or custom)
   - **Region**: Select the region closest to your users / web service.
   - **Plan**: **Free**
4. Click **Create Database**.
5. Once provisioned, scroll down to the **Connections** section:
   - Copy the **Internal Database URL** (for services running inside Render).
   - Or copy the **External Database URL** (for local development or external tools).

### Option B: Supabase / Neon / Other Cloud Providers
1. Create a free account on [Supabase](https://supabase.com/) or [Neon](https://neon.tech/).
2. Create a new PostgreSQL project.
3. Copy the pooled PostgreSQL connection string.

### Option C: Local PostgreSQL (Optional)
If you have PostgreSQL installed locally:
```bash
createdb letschat
# Connection URL format:
# DATABASE_URL=your_postgresql_connection_string_here
```

---

## 3. How to Set DATABASE_URL Locally

The application reads the database connection string strictly from `process.env.DATABASE_URL`.

1. Copy `.env.example` to create your local `.env` file:
   ```bash
   cp .env.example .env
   ```

2. Open `.env` and set your `DATABASE_URL`:
   ```env
   DATABASE_URL=your_postgresql_connection_string_here
   ```

   > **Note**: `.env` is listed in `.gitignore` and must **never** be committed to source control.

3. If `DATABASE_URL` is missing or empty, the application will refuse to start and will log a clear error message instructing you to configure `DATABASE_URL`.

---

## 4. How to Run the Application

### Development Mode
Start the development server with live reload / TypeScript execution:
```bash
npm run dev
```

The application will automatically:
1. Verify the PostgreSQL connection using a connection pool (`pg.Pool`).
2. Automatically execute `CREATE TABLE IF NOT EXISTS` for `users`, `conversations`, and `messages` without dropping any existing data.
3. Start the Express and Socket.IO server at `http://localhost:3000`.

### Production Build & Run
To compile and test the production bundle locally:
```bash
# Bundle the server
npm run build

# Start the compiled production server
npm start
```

---

## 5. How to Deploy to Render

Deploying to Render as a **Free Web Service**:

1. Push your repository to **GitHub** or **GitLab**.
2. Go to your [Render Dashboard](https://dashboard.render.com/) and click **New +** -> **Web Service**.
3. Connect your Git repository.
4. Configure the Web Service settings:
   - **Name**: `letschat-app` (or your preferred name)
   - **Region**: Choose the same region as your Render PostgreSQL database.
   - **Branch**: `main` (or default branch)
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
5. Proceed to **Environment Variables** (see section 6 below).
6. Click **Create Web Service**.

Render will install dependencies, compile the server bundle into `dist/server.cjs`, and launch the web service with Node.

---

## 6. Which Render Environment Variable Must Be Configured

Under the **Environment Variables** section of your Render Web Service, add:

| Key | Value | Description |
|---|---|---|
| `DATABASE_URL` | `your_postgresql_connection_string_here` | **Required.** Provide the PostgreSQL connection string (from Render Postgres, Neon, Supabase, etc.). |
| `NODE_ENV` | `production` | (Optional, default `production` on Render) |

> **Security Reminder**: Never hard-code database credentials in source code or commit `.env` to GitHub. Always set `DATABASE_URL` via the Render dashboard settings.

---

## Features & Capabilities

- **Permanent Code Identity**: Instant browser-scoped cryptographic permanent code (e.g., `AX7K-42PQ`) with secure recovery key.
- **Display Names**: Live editable display names synchronized across partners in real time.
- **Two-Step Verification**: Temporary introduction countdown (90s) followed by a verified handshake token exchange.
- **Full Persistent Chat**: After handshake, conversations and normal messages are stored securely in PostgreSQL with configurable history limits.
- **Ephemeral Private Mode**: End-to-end ephemeral secret chat triggered via the `/private` command or lock button. Private messages reside strictly in temporary server memory and are **never** stored in PostgreSQL.
- **Real-Time Communication**: Live typing indicators, message replies, message deletion, unread badges, and sound alerts.
- **Collapsible Sidebar**: Workspace toggle for PC/desktop with keyboard shortcut `Ctrl+B` / `Cmd+B`.
