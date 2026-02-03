const mysql = require("mysql2/promise");

const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME || "test_recorder",
};

async function check() {
  console.log("Checking DB Health...");
  try {
    const conn = await mysql.createConnection(dbConfig);
    console.log("✔ Connected to database.");

    const [tables] = await conn.query("SHOW TABLES");
    const tableNames = tables.map((t) => Object.values(t)[0]);
    console.log("Tables found:", tableNames.join(", "));

    const required = ["projects", "tests", "suites", "suite_tests", "commands"];
    const missing = required.filter((r) => !tableNames.includes(r));

    if (missing.length === 0) {
      console.log("✔ All required tables exist.");
    } else {
      console.error("✖ Missing tables:", missing.join(", "));
      process.exit(1);
    }

    // Check project data
    const [projects] = await conn.query(
      "SELECT COUNT(*) as count FROM projects",
    );
    console.log(`- Projects: ${projects[0].count}`);

    const [tests] = await conn.query("SELECT COUNT(*) as count FROM tests");
    console.log(`- Tests: ${tests[0].count}`);

    const [commands] = await conn.query(
      "SELECT COUNT(*) as count FROM commands",
    );
    console.log(`- Commands: ${commands[0].count}`);

    await conn.end();
    console.log("✔ Health check PASSED.");
  } catch (err) {
    console.error("✖ Health check FAILED:", err.message);
    process.exit(1);
  }
}

check();
