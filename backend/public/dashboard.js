const API_URL = "http://localhost:4000/api";

async function fetchData(endpoint) {
  try {
    const response = await fetch(`${API_URL}${endpoint}`);
    return await response.json();
  } catch (error) {
    console.error(`Error fetching ${endpoint}:`, error);
    return null;
  }
}

async function updateDashboard() {
  // 1. Fetch data
  const tests = await fetchData("/test-cases");
  if (!tests) return;

  // 2. Update Stats
  document.getElementById("total-tests").querySelector(".value").innerText =
    tests.length;
  document.getElementById("last-update-time").innerText =
    new Date().toLocaleTimeString();

  // 3. Update Pipeline
  const pipelineEl = document.getElementById("test-pipeline");

  // We'll show the most recent 10 tests in the pipeline
  const recentTests = tests.slice(0, 10);

  // Calculate success rate based on recent executions
  let totalExecutions = 0;
  let successfulExecutions = 0;

  // Clear pipeline before re-injecting
  pipelineEl.innerHTML = "";

  for (const test of recentTests) {
    // Fetch executions for this test
    const executions = await fetchData(`/tests/${test.id}/executions`);
    const latest = executions ? executions[0] : null;

    if (latest) {
      totalExecutions++;
      if (latest.status === "success") successfulExecutions++;
    }

    const card = document.createElement("div");
    card.className = `test-card ${latest ? latest.status : ""}`;

    card.innerHTML = `
            <div class="test-id">#${test.id}</div>
            <div class="test-name">${test.name}</div>
            <div class="test-status-text status-${latest ? latest.status : "idle"}">
                ${latest ? latest.status : "READY"}
            </div>
            <div class="test-time" style="font-size: 10px; color: #8b949e;">
                ${latest ? new Date(latest.created_at).toLocaleTimeString() : "Never run"}
            </div>
        `;

    pipelineEl.appendChild(card);
  }

  // Update Success Rate
  const rate =
    totalExecutions > 0
      ? Math.round((successfulExecutions / totalExecutions) * 100)
      : 0;
  document.getElementById("success-rate").querySelector(".value").innerText =
    `${rate}%`;

  // 4. Update Bug Station
  // We'll fetch reports from the most recent failed execution
  const bugListEl = document.getElementById("bug-list");
  const failedTests = tests.filter((t) => t.last_status === "failed"); // Note: current API might not have last_status, we infer

  // For now, let's just show recent execution failures as "bugs"
  let allBugs = [];

  // Check recent executions for failures
  for (const test of recentTests) {
    const executions = await fetchData(`/tests/${test.id}/executions`);
    if (executions && executions[0] && executions[0].status === "failed") {
      allBugs.push({
        testName: test.name,
        message: executions[0].error_message || "Unexpected failure",
        ariaSnapshot: executions[0].aria_snapshot_url,
        time: new Date(executions[0].created_at).toLocaleTimeString(),
      });
    }
  }

  if (allBugs.length > 0) {
    bugListEl.innerHTML = "";
    allBugs.forEach((bug) => {
      const bugCard = document.createElement("div");
      bugCard.className = "bug-card";
      let snapshotHtml = "";
      if (bug.ariaSnapshot) {
        snapshotHtml = `
          <div class="bug-snapshot-link">
            <a href="${bug.ariaSnapshot}" target="_blank" rel="noopener">
              <span class="icon">📄</span> View ARIA Snapshot
            </a>
          </div>`;
      }
      bugCard.innerHTML = `
                <div class="bug-title">Failure in ${bug.testName}</div>
                <div class="bug-desc">${bug.message}</div>
                ${snapshotHtml}
                <div style="font-size: 10px; color: #8b949e; margin-top: 4px;">at ${bug.time}</div>
            `;
      bugListEl.appendChild(bugCard);
    });
  } else {
    bugListEl.innerHTML =
      '<div class="no-bugs">No bugs detected. System clear.</div>';
  }
}

// Initial update and poll
updateDashboard();
setInterval(updateDashboard, 10000); // Update every 10 seconds

function showFullImage(src) {
  const modal = document.createElement("div");
  modal.className = "image-modal";
  modal.innerHTML = `
        <div class="modal-content">
            <span class="close-modal">&times;</span>
            <img src="${src}" style="width: 100%; border-radius: 8px;">
        </div>
    `;
  document.body.appendChild(modal);

  modal.querySelector(".close-modal").onclick = () => modal.remove();
  modal.onclick = (e) => {
    if (e.target === modal) modal.remove();
  };
}
