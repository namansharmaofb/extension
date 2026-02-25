async function test() {
  const fetch = require("node-fetch");

  // 1. Fetch flow 234 from backend to see its raw steps
  const res = await fetch("http://localhost:4000/api/tests/234");
  const data = await res.json();

  console.log("Steps for Flow 234:");
  if (data.steps && data.steps.length > 0) {
    const submitStep = data.steps.find(
      (s) => s.action === "click" && s.description === "Submit",
    );
    console.log(JSON.stringify(submitStep, null, 2));
  } else {
    console.log("No steps");
  }
}

test();
