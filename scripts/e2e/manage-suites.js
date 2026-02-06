// Native fetch is available in Node 18+, no need for node-fetch
const BACKEND_URL = "http://localhost:4000";

async function listTests() {
  const res = await fetch(`${BACKEND_URL}/api/test-cases`);
  const tests = await res.json();
  console.log("\n--- Available Tests ---");
  tests.forEach((t) => console.log(`ID: ${t.id} - Name: ${t.name}`));
}

async function createSuite(name, testIds) {
  // 1. Create Suite
  const res = await fetch(`${BACKEND_URL}/api/projects/1/suites`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`Error: ${res.status} ${res.statusText}`);
    console.error(text);
    return;
  }
  const suite = await res.json();
  console.log(`\nCreated Suite: ${suite.name} (ID: ${suite.id})`);

  // 2. Add Tests
  for (const testId of testIds) {
    await fetch(`${BACKEND_URL}/api/suites/${suite.id}/tests`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ testId }),
    });
    console.log(`Added Test ${testId} to Suite ${suite.id}`);
  }
}

async function listSuites() {
  const res = await fetch(`${BACKEND_URL}/api/projects/1/suites`);
  const suites = await res.json();
  console.log("\n--- Available Suites ---");
  for (const s of suites) {
    const testsRes = await fetch(`${BACKEND_URL}/api/suites/${s.id}/tests`);
    const tests = await testsRes.json();
    console.log(
      `ID: ${s.id} - Name: ${s.name} (Tests: ${tests.map((t) => t.id).join(", ")})`,
    );
  }
}

const args = process.argv.slice(2);
const command = args[0];

if (command === "list-tests") {
  listTests();
} else if (command === "list-suites") {
  listSuites();
} else if (command === "create-suite") {
  const name = args[1];
  const ids = args.slice(2).map(Number);
  if (!name || ids.length === 0) {
    console.log("Usage: node manage-suites.js create-suite 'My Suite' 1 2 3");
  } else {
    createSuite(name, ids);
  }
} else {
  console.log(`
Usage:
  node manage-suites.js list-tests
  node manage-suites.js list-suites
  node manage-suites.js create-suite "Suite Name" test_id1 test_id2 ...
  `);
}
