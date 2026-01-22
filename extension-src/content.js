// Content script: attaches listeners to record clicks and inputs when recording is enabled

let isRecording = false;

function buildSelector(element) {
  if (!element) return "";

  if (element.id) {
    return `#${element.id}`;
  }

  let path = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && path.length < 5) {
    let selector = current.nodeName.toLowerCase();
    if (current.className) {
      const className = current.className
        .toString()
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .join(".");
      if (className) selector += `.${className}`;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (child) => child.nodeName === current.nodeName
      );
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${index})`;
      }
    }
    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(" > ");
}

function handleClick(event) {
  if (!isRecording) return;

  const target = event.target;
  const step = {
    action: "click",
    selector: buildSelector(target),
    tagName: target.tagName,
    url: window.location.href
  };

  chrome.runtime.sendMessage({ type: "RECORD_STEP", step });
}

function handleInput(event) {
  if (!isRecording) return;

  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

  const step = {
    action: "input",
    selector: buildSelector(target),
    tagName: target.tagName,
    value: target.value,
    url: window.location.href
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
        const parts = selector.split(" > ").map(p => p.trim());
        let current = document;
        
        for (const part of parts) {
          if (!current) break;
          const found = current.querySelector ? current.querySelector(part) : null;
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
      console.error(`Error finding element (attempt ${attempt + 1}):`, selector, err);
      if (attempt < retries - 1) {
        const start = Date.now();
        while (Date.now() - start < 50) {} // 50ms wait
      }
    }
  }
  
  return null;
}

async function executeSteps(steps) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    
    // Check if we need to navigate to a different URL
    if (step.url && window.location.href !== step.url) {
      console.log(`Step ${i + 1}: Navigating to ${step.url}`);
      window.location.href = step.url;
      // Wait for page to load
      await new Promise((resolve) => {
        const checkReady = () => {
          if (document.readyState === "complete") {
            setTimeout(resolve, 300);
          } else {
            window.addEventListener("load", () => setTimeout(resolve, 300), { once: true });
            // Fallback timeout
            setTimeout(resolve, 2000);
          }
        };
        checkReady();
      });
      continue; // Skip to next step after navigation
    }
    
    // Find element with retries
    let element = findElementBySelector(step.selector, 3);
    
    if (!element) {
      console.error(`Step ${i + 1}: Element not found for selector: ${step.selector}`);
      chrome.runtime.sendMessage({
        type: "STEP_EXECUTION_ERROR",
        stepIndex: i,
        error: `Element not found: ${step.selector}`
      });
      continue;
    }
    
    try {
      if (step.action === "click") {
        // Quick visibility check - only scroll if really needed
        const rect = element.getBoundingClientRect();
        const isInViewport = rect.top >= -50 && rect.left >= -50 && 
                            rect.bottom <= window.innerHeight + 50 && 
                            rect.right <= window.innerWidth + 50;
        
        if (!isInViewport) {
          element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
          // No wait - scroll is instant with "auto"
        }
        
        // Ensure element is still connected
        if (!element.isConnected) {
          element = findElementBySelector(step.selector, 2);
          if (!element) throw new Error("Element disconnected");
        }
        
        // Trigger click immediately
        element.click();
        console.log(`Step ${i + 1}: Clicked element`);
        
        // Minimal wait - only for async page updates
        await new Promise((resolve) => setTimeout(resolve, 50));
        
      } else if (step.action === "input") {
        // Quick visibility check
        const rect = element.getBoundingClientRect();
        const isInViewport = rect.top >= -50 && rect.left >= -50 && 
                            rect.bottom <= window.innerHeight + 50 && 
                            rect.right <= window.innerWidth + 50;
        
        if (!isInViewport) {
          element.scrollIntoView({ behavior: "auto", block: "center", inline: "center" });
        }
        
        // Ensure element is still connected
        if (!element.isConnected) {
          element = findElementBySelector(step.selector, 2);
          if (!element) throw new Error("Element disconnected");
        }
        
        // Focus and set value immediately
        element.focus();
        element.value = step.value || "";
        
        // Trigger events synchronously
        element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
        element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
        
        console.log(`Step ${i + 1}: Set input value to "${step.value}"`);
        
        // No wait needed for input
      }
      
      // Send success message (non-blocking)
      chrome.runtime.sendMessage({
        type: "STEP_EXECUTED",
        stepIndex: i
      }).catch(() => {}); // Ignore errors if popup is closed
      
    } catch (err) {
      console.error(`Step ${i + 1}: Error executing action`, err);
      chrome.runtime.sendMessage({
        type: "STEP_EXECUTION_ERROR",
        stepIndex: i,
        error: err.message
      }).catch(() => {}); // Ignore errors if popup is closed
    }
  }
  
  console.log("All steps executed");
  return { success: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SET_RECORDING") {
    isRecording = message.isRecording;
    sendResponse({ success: true, isRecording });
  } else if (message.type === "EXECUTE_STEPS") {
    // Send immediate acknowledgment
    sendResponse({ success: true, message: "Execution started" });
    
    // Execute steps asynchronously without blocking the response
    executeSteps(message.steps).then((result) => {
      // Send completion message via runtime message (not response)
      chrome.runtime.sendMessage({
        type: "FLOW_EXECUTION_COMPLETE",
        success: true,
        stepCount: message.steps.length
      }).catch(() => {
        // Popup might be closed, that's okay
        console.log("Flow execution completed (popup may be closed)");
      });
    }).catch((err) => {
      chrome.runtime.sendMessage({
        type: "FLOW_EXECUTION_COMPLETE",
        success: false,
        error: err.message
      }).catch(() => {
        console.log("Flow execution failed (popup may be closed)");
      });
    });
    
    return false; // Response already sent
  }

  return true;
});
