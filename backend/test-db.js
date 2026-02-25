const mysql = require("mysql2/promise");

async function check() {
  const pool = mysql.createPool({
    host: "localhost",
    user: "root",
    password: process.env.DB_PASSWORD || "naman123", // I recall it might be 'root' or 'naman123', I will try to connect
    database: "antigravity",
  });

  try {
    const [rows] = await pool.query(
      "SELECT * FROM commands WHERE test_id=233 LIMIT 1",
    );
    console.log(rows);
    if (rows.length > 0) {
      console.log("targets type:", typeof rows[0].targets);
      console.log("selectors type:", typeof rows[0].selectors);
      console.log("modal_context type:", typeof rows[0].modal_context);
    }
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

check();
