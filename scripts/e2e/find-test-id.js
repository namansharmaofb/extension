const mysql = require("mysql2/promise");
require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });

async function findTest() {
  const connection = await mysql.createConnection({
    socketPath: "/var/run/mysqld/mysqld.sock",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "test_recorder",
  });

  const [rows] = await connection.execute(
    "SELECT id, name FROM tests WHERE name LIKE ? OR name LIKE ?",
    ["%login%", "%order%"],
  );

  console.log("Found Tests:");
  rows.forEach((r) => console.log(`ID: ${r.id} | Name: ${r.name}`));
  process.exit();
}

findTest();
