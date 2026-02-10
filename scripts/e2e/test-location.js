/**
 * Simple test for element location logic in playback.js
 */

// Mock elements
const elements = [
  {
    tagName: "SPAN",
    innerText: "Not Applicable",
    isVisible: true,
    getAttribute: () => "Not Applicable",
  },
  {
    tagName: "SPAN",
    innerText: "Supplier",
    isVisible: true,
    getAttribute: () => "Supplier",
  },
  {
    tagName: "SPAN",
    innerText: "Other",
    isVisible: false,
    getAttribute: () => "Other",
  },
];

// Mock helper functions
function isElementVisible(el) {
  return el.isVisible;
}
function getVisibleText(el) {
  return el.innerText;
}

function testLocateElement(elements, description) {
  const expectedText = description.toLowerCase().trim();

  let el = null;
  if (expectedText && expectedText.length > 2) {
    el = elements.find((e) => {
      const visible = isElementVisible(e);
      if (!visible) return false;
      const text = getVisibleText(e).toLowerCase().trim();
      return text === expectedText || text.includes(expectedText);
    });
  }

  if (!el) el = elements.find(isElementVisible) || elements[0];
  return el;
}

console.log("Searching for 'Supplier' among multiple matches...");
const matched = testLocateElement(elements, "Supplier");

console.log(`Found element with text: '${matched.innerText}'`);

if (matched.innerText === "Supplier") {
  console.log("\nSUCCESS: Correct element found based on text match.");
} else {
  console.error("\nFAILURE: Wrong element found.");
  process.exit(1);
}

console.log(
  "\nSearching for 'NonExistent' (should fall back to first visible)...",
);
const fallback = testLocateElement(elements, "NonExistent");
console.log(`Found element with text: '${fallback.innerText}'`);

if (fallback.innerText === "Not Applicable") {
  console.log("\nSUCCESS: Correctly fell back to first visible element.");
} else {
  console.error("\nFAILURE: Fallback failed.");
  process.exit(1);
}
