// Utility to merge multiple tests into a new combined test
const BACKEND_URL = "http://localhost:4000";

async function mergeTests(testIds, newName) {
  console.log(`Merging tests: ${testIds.join(", ")} into "${newName}"...`);

  let allSteps = [];
  let projectId = 1; // Default project

  for (const id of testIds) {
    const res = await fetch(`${BACKEND_URL}/api/test-cases/${id}`);
    if (!res.ok) throw new Error(`Failed to fetch test ${id}`);
    const test = await res.json();
    projectId = test.project_id || 1;

    // Filter out redundant navigations to the same domain if desired
    // (We'll keep them for safety unless they are exact duplicates)
    allSteps = allSteps.concat(test.steps || []);
  }

  // Map steps to the format expected by the API
  const formattedSteps = allSteps.map((s) => ({
    action: s.action || s.command,
    target: s.selector || s.target,
    targets: s.targets || [],
    value: s.value,
    description: s.description,
    url: s.url,
  }));

  const createRes = await fetch(
    `${BACKEND_URL}/api/projects/${projectId}/tests`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName,
        steps: formattedSteps,
      }),
    },
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create merged test: ${err}`);
  }

  const result = await createRes.json();
  console.log(`Successfully merged! New Test ID: ${result.id}`);
  return result.id;
}

const args = process.argv.slice(2);
if (args.length < 3) {
  console.log(
    'Usage: node merge-tests.js <test_id1> <test_id2> ... "New Test Name"',
  );
  process.exit(1);
}

const newName = args.pop();
const testIds = args.map(Number);

mergeTests(testIds, newName).catch((err) => {
  console.error("Merge Error:", err.message);
  process.exit(1);
});
