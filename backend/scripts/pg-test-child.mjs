// Run by postgres.test.js as a separate process, to prove locks and charges hold across servers.
// Usage: node pg-child.mjs <mode> <args…>   (DATABASE_URL points at the test Postgres)
import { setTimeout as sleep } from "node:timers/promises";

const [mode, ...args] = process.argv.slice(2);
const database = await import("../src/database.js");
const minutes = await import("../src/minutes.js");
await database.initializeDatabase();

try {
  if (mode === "enter-lock") {
    // Waits for the account lock and reports when it got it.
    await minutes.withAccountLock(args[0], async () => {
      console.log(JSON.stringify({ enteredAt: Date.now() }));
    });
  } else if (mode === "charge") {
    // Starts at the agreed moment, then tries to pay for one job.
    const [jobId, billingId, startAt] = args;
    await sleep(Math.max(0, Number(startAt) - Date.now()));
    const job = await database.getJob(Number(jobId));
    try {
      await minutes.ensureCharged(job, { billingId, allowance: 0, periodEnd: null });
      console.log(JSON.stringify({ result: "paid" }));
    } catch (error) {
      console.log(JSON.stringify({ result: error instanceof minutes.NotEnoughMinutes ? "refused" : `error: ${error.message}` }));
    }
  }
} finally {
  await database.closeDatabase();
}
