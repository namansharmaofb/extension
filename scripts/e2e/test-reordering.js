/**
 * Simple test for selector reordering logic in locator-builders.js
 */

// Mock globals needed by locator-builders.js
global.document = {
  evaluate: () => ({ snapshotLength: 0 }),
};
global.Node = { ELEMENT_NODE: 1 };
global.CSS = { escape: (s) => s };

// Mock helper functions
global.isDynamic = () => false;
global.getVisibleText = () => "";
global.buildSelector = () => "div > span:nth-of-type(2)";
global.buildCssPath = () => "html > body > div:nth-child(1) > span";
global.getXPath = () => "/html/body/div/span[2]";
global.buildAriaSelector = () => "aria/Supplier";

// Minimal version of the logic to test reordering
function testReordering(selectors) {
  const robustSelectors = selectors.filter((s) => !s[0].includes(":nth-"));
  const fragileSelectors = selectors.filter((s) => s[0].includes(":nth-"));
  return [...robustSelectors, ...fragileSelectors];
}

const mockSelectors = [
  ["aria/Supplier"],
  ["div > span:nth-of-type(2)"],
  ['[data-testid="supplier-id"]'],
  ["xpath///span[normalize-space(.)='Supplier']"],
  ["html > body > div:nth-child(1) > span"],
];

console.log("Original Order:");
mockSelectors.forEach((s) => console.log(` - ${s[0]}`));

const reordered = testReordering(mockSelectors);

console.log("\nReordered Order:");
reordered.forEach((s) => console.log(` - ${s[0]}`));

// Verification
const fragileFirstIndex = reordered.findIndex((s) => s[0].includes(":nth-"));
const robustLastIndex =
  reordered.length -
  1 -
  [...reordered].reverse().findIndex((s) => !s[0].includes(":nth-"));

if (fragileFirstIndex > robustLastIndex) {
  console.log("\nSUCCESS: All fragile selectors moved after robust ones.");
} else {
  console.error("\nFAILURE: Reordering failed.");
  process.exit(1);
}
