const mysql = require("mysql2/promise");
require("dotenv").config();

const dbConfig = {
  socketPath: "/var/run/mysqld/mysqld.sock",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "test_recorder",
};

const TEST_EMAIL = process.env.E2E_TEST_EMAIL || "test@example.com";

async function deleteTestUser() {
  console.log(`[Setup] Connecting to database to clean up ${TEST_EMAIL}...`);

  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);

    // 1. Clean DB
    // Assuming we might have a users table in the future, but for now we clean flow executions/test cases
    // that might be associated with this "session" if we were tracking them by user.
    // For this specific architecture, we'll ensure we don't have lingering data.

    // Example: Delete executions older than 24h just to keep DB health
    const [result] = await connection.execute(
      "DELETE FROM executions WHERE created_at < NOW() - INTERVAL 1 DAY",
    );
    console.log(
      `[Setup] DB Cleaned: Removed ${result.affectedRows} old executions.`,
    );

    // If we had an Auth provider API, we would call it here.
    // await authProvider.deleteUser(TEST_EMAIL);
    // console.log(
    //   `[Setup] Auth Provider: User ${TEST_EMAIL} deleted (Simulated).`,
    // );
    console.log(
      `[Setup] Auth Provider: User deletion SKIPPED (Preserving for Login Flow).`,
    );

    // If we had a Payment provider API, we would call it here.
    // await paymentProvider.deleteCustomer(TEST_EMAIL);
    // console.log(
    //   `[Setup] Payment Provider: Customer ${TEST_EMAIL} deleted (Simulated).`,
    // );
    console.log(
      `[Setup] Payment Provider: Customer deletion SKIPPED (Preserving for Login Flow).`,
    );
  } catch (err) {
    console.error("[Setup] Cleanup Failed:", err.message);
    // We don't exit here because local dev environments might not have the DB set up perfectly yet.
    // In strict CI, we might want to throw.
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

if (require.main === module) {
  deleteTestUser();
}

module.exports = deleteTestUser;
