const mysql = require("mysql2/promise");

const dbConfig = {
  socketPath: "/var/run/mysqld/mysqld.sock",
  user: "root",
  password: "",
  database: "test_recorder",
};

async function repair() {
  const connection = await mysql.createConnection(dbConfig);
  console.log("Repairing selectors...");

  // 1. Repair Email Input (tfid-0-1 -> placeholder="Enter email address")
  await connection.query(
    `UPDATE commands SET target = 'input[placeholder="Enter email address"]' 
     WHERE target LIKE '#tfid-%' AND description LIKE '%email%'`,
  );

  // 2. Repair Organization Selection (tfid-0-0 -> input[name="organisation"][value="825176781110645436"])
  // We use the known value 825176781110645436 for this specific user/test
  await connection.query(
    `UPDATE commands SET target = 'input[name="organisation"][value="825176781110645436"]' 
     WHERE target LIKE '#tfid-%organisation%'`,
  );

  // 3. General cleanup for Step 48/49 of test 133 specifically if needed
  await connection.query(
    `UPDATE commands SET target = 'input[name="organisation"][value="825176781110645436"]' 
     WHERE test_id = 133 AND step_order IN (48, 49, 50)`,
  );

  console.log("Repair complete.");
  await connection.end();
}

repair().catch(console.error);
