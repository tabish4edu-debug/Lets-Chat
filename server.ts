import { startServer } from "./server/server";

startServer().catch((err) => {
  console.error("Fatal error running server:", err);
  process.exit(1);
});
