const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Configure your MySQL connection via env vars or defaults
const dbConfig = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  // Default to empty password so it works with local MySQL setups
  // where the root user has no password configured.
  password: process.env.DB_PASSWORD ?? "",
  database: process.env.DB_NAME || "test_recorder",
};

let pool;

async function initDb() {
  pool = await mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  // Create tables if they do not exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS test_cases (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS test_steps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      test_case_id INT NOT NULL,
      step_order INT NOT NULL,
      action VARCHAR(50) NOT NULL,
      selector TEXT,
      tag_name VARCHAR(50),
      value TEXT,
      url TEXT,
      timestamp BIGINT,
      FOREIGN KEY (test_case_id) REFERENCES test_cases(id) ON DELETE CASCADE
    );
  `);
}

app.post("/api/test-cases", async (req, res) => {
  const { name, steps } = req.body || {};

  if (!name || !Array.isArray(steps)) {
    return res.status(400).json({ error: "Missing 'name' or 'steps' array" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [caseResult] = await conn.query(
      "INSERT INTO test_cases (name) VALUES (?)",
      [name]
    );

    const testCaseId = caseResult.insertId;

    const stepValues = steps.map((step, index) => [
      testCaseId,
      index + 1,
      step.action || null,
      step.selector || null,
      step.tagName || null,
      step.value || null,
      step.url || null,
      step.timestamp || null,
    ]);

    if (stepValues.length > 0) {
      await conn.query(
        `INSERT INTO test_steps
          (test_case_id, step_order, action, selector, tag_name, value, url, timestamp)
         VALUES ?`,
        [stepValues]
      );
    }

    await conn.commit();

    res.json({ id: testCaseId, name, stepCount: steps.length });
  } catch (err) {
    await conn.rollback();
    console.error("Error saving test case", err);
    res.status(500).json({ error: "Failed to save test case" });
  } finally {
    conn.release();
  }
});

app.get("/api/test-cases", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM test_cases ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) {
    console.error("Error fetching test cases", err);
    res.status(500).json({ error: "Failed to fetch test cases" });
  }
});

app.get("/api/test-cases/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [[testCase]] = await pool.query(
      "SELECT * FROM test_cases WHERE id = ?",
      [id]
    );
    if (!testCase) return res.status(404).json({ error: "Not found" });

    const [steps] = await pool.query(
      "SELECT * FROM test_steps WHERE test_case_id = ? ORDER BY step_order ASC",
      [id]
    );

    res.json({ ...testCase, steps });
  } catch (err) {
    console.error("Error fetching test case", err);
    res.status(500).json({ error: "Failed to fetch test case" });
  }
});

app.delete("/api/test-cases/:id", async (req, res) => {
  const { id } = req.params;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Check if test case exists
    const [[testCase]] = await conn.query(
      "SELECT * FROM test_cases WHERE id = ?",
      [id]
    );
    if (!testCase) {
      await conn.rollback();
      return res.status(404).json({ error: "Test case not found" });
    }

    // Delete steps first (foreign key constraint)
    await conn.query("DELETE FROM test_steps WHERE test_case_id = ?", [id]);

    // Delete test case
    await conn.query("DELETE FROM test_cases WHERE id = ?", [id]);

    await conn.commit();

    res.json({ success: true, message: `Test case '${testCase.name}' deleted successfully` });
  } catch (err) {
    await conn.rollback();
    console.error("Error deleting test case", err);
    res.status(500).json({ error: "Failed to delete test case" });
  } finally {
    conn.release();
  }
});

app.listen(PORT, async () => {
  try {
    await initDb();
    console.log(`Server listening on port ${PORT}`);
  } catch (err) {
    console.error("Failed to initialize database", err);
    process.exit(1);
  }
});
