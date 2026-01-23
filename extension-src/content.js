// Content script: attaches listeners to record clicks and inputs when recording is enabled

let isRecording = false;

function buildSelector(element) {
  if (!element) return "";

  // 1. Try ID if it look stable (not auto-generated)
  if (element.id && !isDynamicId(element.id)) {
    return `#${element.id}`;
  }

  // 2. Try stable attributes (data-testid, etc.)
  const stableAttrs = [
    "data-testid",
    "data-cy",
    "data-test-id",
    "data-qa",
    "name",
    "role",
    "placeholder",
    "aria-label",
  ];
  for (const attr of stableAttrs) {
    if (element.hasAttribute(attr)) {
      const val = element.getAttribute(attr);
      if (val && !isDynamicId(val)) {
        return `${element.tagName.toLowerCase()}[${attr}="${val}"]`;
      }
    }
  }

  // 3. Fallback: Generate path
  let path = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 5) {
    let selector = current.nodeName.toLowerCase();

    // Add stable classes only
    if (current.className) {
      const classes = current.className.toString().trim().split(/\s+/);
      const stableClasses = classes.filter((cls) => !isDynamicClass(cls));
      if (stableClasses.length > 0) {
        selector += `.${stableClasses.slice(0, 2).join(".")}`;
      }
    }

    // Add nth-of-type if needed for uniqueness among siblings
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.nodeName === current.nodeName,
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }

    path.unshift(selector);
    current = current.parentElement;

    // Check if current ancestor has a stable attribute (ID or other)
    // 1. Check ID
    if (current && current.id && !isDynamicId(current.id)) {
      path.unshift(`#${current.id}`);
      break; // Stop climbing if we hit a stable ID
    }

    // 2. Check other stable attributes on ancestors
    let foundStableAttr = false;
    for (const attr of stableAttrs) {
      if (current.hasAttribute(attr)) {
        const val = current.getAttribute(attr);
        if (val && !isDynamicId(val)) {
          // We found a stable root!
          // e.g. div[placeholder="Search"]
          path.unshift(`${current.tagName.toLowerCase()}[${attr}="${val}"]`);
          foundStableAttr = true;
          break;
        }
      }
    }
    if (foundStableAttr) break; // Stop climbing
  }

  return path.join(" > ");
}

// Helper to detect if an ID/Class looks auto-generated (e.g. "lAIJgo", "input-12345")
function isDynamicId(str) {
  if (!str) return false;
  // Common patterns for dynamic strings:
  // - Contains long numbers (3+ digits) e.g. "ember123"
  // - Short random alphanumeric e.g. "abc1z"
  // - Starts with a number

  if (/^\d/.test(str)) return true; // Starts with digit
  if (/\d{4,}/.test(str)) return true; // Has 4+ consecutive digits

  // Random hash-like (4-8 chars, mixed case numbers) - crude heuristic
  // e.g. "lAIJgo"
  if (/^[a-zA-Z0-9]{5,8}$/.test(str) && /[0-9]/.test(str) === false) {
    // This is risky, "header" is 6 chars.
    // User's example "lAIJgo" is 6 chars mixed case.
    // Let's look for mixed case + no obvious meaning?
    // Better: assume if capital letters are present inside?
    if (/[a-z]/.test(str) && /[A-Z]/.test(str)) return true;
  }

  return false;
}

function isDynamicClass(cls) {
  return isDynamicId(cls);
}

function handleClick(event) {
  if (!isRecording) return;

  const target = event.target;
  const step = {
    action: "click",
    selector: buildSelector(target),
    tagName: target.tagName,
    url: window.location.href,
  };

  chrome.runtime.sendMessage({ type: "RECORD_STEP", step });
}

function handleInput(event) {
  if (!isRecording) return;

  const target = event.target;
  if (
    !(
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement
    )
  )
    return;

  const step = {
    action: "input",
    selector: buildSelector(target),
    tagName: target.tagName,
    value: target.value,
    url: window.location.href,
  };

  chrome.runtime.sendMessage({ type: "RECORD_STEP", step });
}

window.addEventListener("click", handleClick, true);
window.addEventListener("change", handleInput, true);
window.addEventListener("input", handleInput, true);

function findElementBySelector(selector, retries = 3) {
  if (!selector) return null;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      // Try direct querySelector first (most common case)
      const element = document.querySelector(selector);
      if (element && element.isConnected) return element;

      // If selector has " > ", try splitting and navigating
      if (selector.includes(" > ")) {
        const parts = selector.split(" > ").map((p) => p.trim());
        let current = document;

        for (const part of parts) {
          if (!current) break;
          const found = current.querySelector
            ? current.querySelector(part)
            : null;
          if (found) {
            current = found;
          } else {
            current = null;
            break;
          }
        }

        if (current && current instanceof Element && current.isConnected) {
          return current;
        }
      }

      // Try with slight delay if not found (for dynamic content)
      if (attempt < retries - 1) {
        // Small delay before retry
        const start = Date.now();
        while (Date.now() - start < 50) {} // 50ms wait
      }
    } catch (err) {
      console.error(
        `Error finding element (attempt ${attempt + 1}):`,
        selector,
        err,
      );
      if (attempt < retries - 1) {
        const start = Date.now();
        while (Date.now() - start < 50) {} // 50ms wait
      }
    }
  }

  return null;
}

// Single step execution for robust background-driven flow
async function executeSingleStep(step, index) {
  try {
    // Find element with retries
    let element = findElementBySelector(step.selector, 3);

    if (!element) {
      throw new Error(`Element not found for selector: ${step.selector}`);
    }

    if (step.action === "click") {
      // Scroll if needed
      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });
      await new Promise((r) => setTimeout(r, 50));

      if (!element.isConnected) {
        element = findElementBySelector(step.selector, 2);
        if (!element) throw new Error("Element disconnected");
      }

      element.click();
      console.log(`Executed step ${index + 1}: Click`);

      // Send completion immediately. If page unloads, background handles it.
      chrome.runtime.sendMessage({ type: "STEP_COMPLETE", stepIndex: index });
    } else if (step.action === "input") {
      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });
      element.focus();
      element.value = step.value || "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));

      console.log(`Executed step ${index + 1}: Input "${step.value}"`);
      chrome.runtime.sendMessage({ type: "STEP_COMPLETE", stepIndex: index });
    }
  } catch (err) {
    console.error(`Error executing step ${index + 1}:`, err);
    chrome.runtime.sendMessage({
      type: "STEP_ERROR",
      error: err.message,
      stepIndex: index,
    });
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SET_RECORDING") {
    isRecording = message.isRecording;
    sendResponse({ success: true, isRecording });
  } else if (message.type === "EXECUTE_SINGLE_STEP") {
    // Execute single step
    executeSingleStep(message.step, message.stepIndex);
    sendResponse({ success: true, message: "Step execution started" });
  } else if (message.type === "EXECUTE_STEPS") {
    // Legacy support or fallback?
    // We are deprecating this in favor of background-driven, but keeping it for safety
    // if old code is still calling it (though we updated popup.js).
    // Let's just log a warning.
    console.warn("Received deprecated EXECUTE_STEPS message");
    sendResponse({ success: false, error: "Deprecated method" });
  }

  return true;
});
