// Engine for finding elements and executing commands during flow playback
let lastInteractedElement = null;
let lastActiveOverlayElement = null;
let pinnedOverlayElement = null;

const OVERLAY_CONTAINER_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  "dialog",
  "[data-popper-placement]",
  "[data-radix-popper-content-wrapper]",
  "[data-radix-dialog-content]",
  "[data-floating-ui-portal]",
  '[class*="MuiModal"]',
  '[class*="MuiDialog"]',
  '[class*="MuiDrawer"]',
  '[class*="MuiPopover"]',
  '[class*="MuiPopper"]',
  '[class*="ant-modal"]',
  '[class*="ant-drawer"]',
  '[class*="chakra-modal"]',
  '[class*="chakra-popover"]',
  '[class*="react-select__menu"]',
  '[class*="slds-modal"]',
  '[class*="slds-dropdown"]',
].join(", ");

/**
 * Extracts the accessible name and optional role from an ARIA selector string.
 * Handles both plain "Name" and "role[Name]" formats.
 * @param {string} ariaText - The text after "aria/" prefix
 * @returns {{name: string, role: string|null}} The extracted name and role
 */
function parseAriaSelector(ariaText) {
  if (!ariaText) return { name: "", role: null };
  const roleMatch = ariaText.match(/^([a-z]+)\[(.+)\]$/);
  if (roleMatch) {
    return { name: roleMatch[2], role: roleMatch[1] };
  }
  return { name: ariaText, role: null };
}

/**
 * Legacy helper — extracts just the accessible name.
 * @param {string} ariaText
 * @returns {string}
 */
function extractAriaName(ariaText) {
  return parseAriaSelector(ariaText).name;
}

/**
 * Checks if an element is inside an overlay container (modal, popover, dropdown, drawer).
 * @param {HTMLElement} el
 * @returns {boolean}
 */
function isOverlayContainer(el) {
  if (!el || el === document.body) return false;

  const role = (el.getAttribute("role") || "").toLowerCase();
  if (
    [
      "dialog",
      "alertdialog",
      "menu",
      "listbox",
      "tooltip",
      "tree",
      "presentation",
    ].includes(role)
  )
    return true;
  if (el.tagName === "DIALOG") return true;

  const cls = el.className || "";
  if (
    typeof cls === "string" &&
    (/\b(modal|popover|dropdown-menu|drawer|popup|overlay)\b/i.test(cls) ||
      /\b(MuiModal|MuiPopover|MuiDrawer|MuiDialog|MuiMenu-paper|MuiAutocomplete-popper)\b/i.test(
        cls,
      ) ||
      /\b(ant-modal|ant-popover|ant-dropdown|ant-drawer|ant-select-dropdown)\b/i.test(
        cls,
      ) ||
      /\b(modal-dialog|modal-content)\b/i.test(cls) ||
      /\b(portal|react-select__menu|slds-modal|slds-dropdown|chakra-modal|chakra-popover)\b/i.test(
        cls,
      ))
  )
    return true;

  if (
    el.hasAttribute("data-popper-placement") ||
    el.hasAttribute("data-radix-popper-content-wrapper") ||
    el.hasAttribute("data-radix-dialog-content") ||
    el.hasAttribute("data-floating-ui-portal")
  )
    return true;

  const style = window.getComputedStyle(el);
  if (
    (style.position === "fixed" || style.position === "absolute") &&
    parseInt(style.zIndex, 10) >= 100
  ) {
    const rect = el.getBoundingClientRect();
    if (rect.width > 80 && rect.height > 40) return true;
  }

  return false;
}

function isInsideOverlay(el) {
  let current = el ? el.parentElement : null;
  let depth = 0;
  while (current && current !== document.body && depth < 30) {
    if (isOverlayContainer(current)) return true;
    current = current.parentElement;
    depth++;
  }
  return false;
}

function getNearestOverlayContainer(el) {
  let current = el || null;
  let depth = 0;
  while (current && current !== document.body && depth < 30) {
    if (isOverlayContainer(current)) return current;
    current = current.parentElement;
    depth++;
  }
  return null;
}

function getElementMaxZIndex(el) {
  let current = el;
  let maxZ = -1;
  let depth = 0;
  while (current && current !== document.body && depth < 30) {
    const z = parseInt(window.getComputedStyle(current).zIndex, 10);
    if (!isNaN(z) && z > maxZ) maxZ = z;
    current = current.parentElement;
    depth++;
  }
  return maxZ;
}

function chooseTopmostElement(elements) {
  if (!elements || elements.length === 0) return null;
  if (elements.length === 1) return elements[0];

  const active = document.activeElement;
  const scored = elements.map((el) => {
    const overlay = getNearestOverlayContainer(el) || (isOverlayContainer(el) ? el : null);
    return {
      el,
      zIndex: getElementMaxZIndex(el),
      containsActive:
        !!active &&
        active !== document.body &&
        (el.contains(active) || (!!overlay && overlay.contains(active))),
    };
  });

  scored.sort((a, b) => {
    if (a.containsActive !== b.containsActive) {
      return a.containsActive ? -1 : 1;
    }
    if (a.zIndex !== b.zIndex) {
      return b.zIndex - a.zIndex;
    }

    const position = a.el.compareDocumentPosition(b.el);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) return 1;
    if (position & Node.DOCUMENT_POSITION_PRECEDING) return -1;
    return 0;
  });

  return scored[0].el;
}

function overlayHasVisibleContent(overlay) {
  if (!overlay || !overlay.isConnected) return false;
  if (isElementVisible(overlay)) return true;

  const descendants = overlay.querySelectorAll("*");
  for (const child of descendants) {
    if (isElementVisible(child)) return true;
  }
  return false;
}

function getVisibleOverlayCandidates() {
  const rawCandidates = Array.from(
    document.querySelectorAll(OVERLAY_CONTAINER_SELECTOR),
  ).filter(
    (candidate) =>
      isOverlayContainer(candidate) && overlayHasVisibleContent(candidate),
  );

  return rawCandidates.filter(
    (candidate) => !getNearestOverlayContainer(candidate.parentElement),
  );
}

function getTopmostActiveOverlay() {
  const candidates = getVisibleOverlayCandidates();

  if (
    lastActiveOverlayElement &&
    lastActiveOverlayElement.isConnected &&
    isOverlayContainer(lastActiveOverlayElement) &&
    overlayHasVisibleContent(lastActiveOverlayElement) &&
    !candidates.includes(lastActiveOverlayElement)
  ) {
    candidates.push(lastActiveOverlayElement);
  }

  const overlay = chooseTopmostElement(candidates);
  lastActiveOverlayElement = overlay || null;
  return lastActiveOverlayElement;
}

function getPinnedOverlayContext() {
  if (
    pinnedOverlayElement &&
    pinnedOverlayElement.isConnected &&
    isOverlayContainer(pinnedOverlayElement) &&
    overlayHasVisibleContent(pinnedOverlayElement)
  ) {
    return pinnedOverlayElement;
  }

  pinnedOverlayElement = null;
  return null;
}

function prioritizeCurrentOverlayMatches(elements) {
  if (!elements || elements.length === 0) return [];

  const overlay = getPinnedOverlayContext() || getTopmostActiveOverlay();
  if (!overlay) return elements;

  const scoped = elements.filter((candidate) =>
    candidate === overlay || overlay.contains(candidate),
  );
  return scoped.length > 0 ? scoped : elements;
}

function getPageRect(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return {
    x: Math.round(rect.left + window.scrollX),
    y: Math.round(rect.top + window.scrollY),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function scoreCandidateAgainstRecordedRect(step, element) {
  if (!step?.nuanceMetadata?.rect || !element) return null;

  const recordedRect = step.nuanceMetadata.rect;
  const rect = getPageRect(element);
  if (!rect) return null;

  const recordedCenterX = recordedRect.x + recordedRect.width / 2;
  const recordedCenterY = recordedRect.y + recordedRect.height / 2;
  const currentCenterX = rect.x + rect.width / 2;
  const currentCenterY = rect.y + rect.height / 2;

  const distance = Math.hypot(
    currentCenterX - recordedCenterX,
    currentCenterY - recordedCenterY,
  );
  const sizeDelta =
    Math.abs(rect.width - recordedRect.width) +
    Math.abs(rect.height - recordedRect.height);
  const tagPenalty =
    step.tagName &&
    typeof step.tagName === "string" &&
    element.tagName !== step.tagName
      ? 500
      : 0;

  return distance + sizeDelta * 2 + tagPenalty;
}

function chooseBestCandidateByRecordedRect(step, elements) {
  if (
    !step ||
    step.action !== "click" ||
    !step.nuanceMetadata?.rect ||
    !elements ||
    elements.length < 2
  ) {
    return null;
  }

  const scored = elements
    .map((element) => ({
      element,
      score: scoreCandidateAgainstRecordedRect(step, element),
    }))
    .filter((entry) => entry.score !== null && Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score);

  if (scored.length === 0) return null;
  if (scored.length === 1) return scored[0].element;

  const best = scored[0];
  const second = scored[1];

  // Only trust geometry when the best match is meaningfully better.
  if (best.score <= 80 || best.score + 40 < second.score) {
    return best.element;
  }

  return null;
}

function hasEditLikeSignal(element) {
  if (!element) return false;

  const ariaLabel = (element.getAttribute("aria-label") || "").toLowerCase();
  if (ariaLabel.includes("edit")) return true;

  const title = (element.getAttribute("title") || "").toLowerCase();
  if (title.includes("edit")) return true;

  const text = getVisibleText(element).toLowerCase();
  if (text === "edit" || text.includes(" edit")) return true;

  const icon = element.querySelector(
    "svg, i, .material-icons, .MuiSvgIcon-root, .fa, .fas, .far",
  );
  if (!icon) return false;

  const className =
    typeof icon.className === "string" ? icon.className : icon.className?.baseVal;
  const signals = [
    icon.getAttribute("data-testid"),
    icon.getAttribute("name"),
    icon.getAttribute("aria-label"),
    icon.getAttribute("title"),
    className,
    icon.textContent,
  ];

  return signals.some(
    (value) => typeof value === "string" && /(edit|pencil|create)/i.test(value),
  );
}

function extractNextStepContextTokens(step) {
  const nextStep = step?.nextStep;
  if (!nextStep) return [];

  const sources = [
    nextStep.description,
    nextStep.target,
    nextStep.selector,
    ...(Array.isArray(nextStep.selectors)
      ? nextStep.selectors.map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      : []),
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase()
    .replace(/aria\//g, " ")
    .replace(/xpath\//g, " ")
    .replace(/[\[\]()*>"'=:/,.-]+/g, " ");

  const stopWords = new Set([
    "aria",
    "xpath",
    "button",
    "combobox",
    "textbox",
    "dialog",
    "drawer",
    "input",
    "option",
    "selected",
    "remove",
    "click",
    "edit",
    "update",
    "submit",
    "value",
    "role",
    "div",
    "span",
    "form",
  ]);

  return Array.from(
    new Set(
      sources
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(
          (token) =>
            token.length >= 4 &&
            !stopWords.has(token) &&
            !/^\d+$/.test(token),
        ),
    ),
  );
}

function normalizeContextString(value) {
  return (value || "")
    .toLowerCase()
    .replace(/aria\//g, " ")
    .replace(/xpath\//g, " ")
    .replace(/[\[\]()*>"'=:/,.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNextStepContextPhrases(step) {
  const nextStep = step?.nextStep;
  if (!nextStep) return [];

  const sources = [
    nextStep.description,
    nextStep.target,
    nextStep.selector,
  ].filter((value) => typeof value === "string");

  return Array.from(
    new Set(
      sources
        .map(normalizeContextString)
        .filter((value) => value.length >= 4),
    ),
  );
}

function countEditSignalsWithin(container, currentElement) {
  if (!container || !container.querySelectorAll) return 0;
  return Array.from(
    container.querySelectorAll('button, [role="button"], a, [tabindex]'),
  ).filter(
    (candidate) =>
      candidate !== currentElement &&
      candidate.isConnected &&
      isElementVisible(candidate) &&
      hasEditLikeSignal(candidate),
  ).length;
}

function scoreParentContainerForContext(container, step, currentElement, depth) {
  if (!container) return null;

  const text = normalizeContextString(getVisibleText(container));
  if (!text || text.length < 4) return null;
  if (text.length > 800) return null;

  const phrases = extractNextStepContextPhrases(step);
  const tokens = extractNextStepContextTokens(step);
  const phraseScore = phrases.reduce(
    (total, phrase) => total + (text.includes(phrase) ? phrase.length * 25 : 0),
    0,
  );
  const tokenScore = tokens.reduce(
    (total, token) => total + (text.includes(token) ? token.length * 4 : 0),
    0,
  );

  if (phraseScore === 0 && tokenScore === 0) return null;

  const extraEditSignals = countEditSignalsWithin(container, currentElement);
  const proximityBonus = Math.max(0, 30 - depth * 4);
  const densityPenalty = extraEditSignals * 12;
  const lengthPenalty = Math.max(0, Math.floor(text.length / 120));

  return phraseScore + tokenScore + proximityBonus - densityPenalty - lengthPenalty;
}

function findBestContextContainerForEdit(element, step) {
  let current = element;
  let depth = 0;
  let best = null;

  while (current && current !== document.body && depth < 7) {
    const score = scoreParentContainerForContext(current, step, element, depth);
    if (score !== null && (!best || score > best.score)) {
      best = { container: current, score, depth };
    }
    current = current.parentElement;
    depth++;
  }

  return best;
}

function chooseBestCandidateByParentContext(step, elements) {
  if (!step?.nextStep || !elements || elements.length < 2) return null;

  const scored = elements
    .map((element) => {
      const bestContainer = findBestContextContainerForEdit(element, step);
      return {
        element,
        score: bestContainer?.score ?? null,
        depth: bestContainer?.depth ?? 99,
      };
    })
    .filter((entry) => entry.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.depth - b.depth;
    });

  if (scored.length === 0) return null;
  if (scored.length === 1) return scored[0].element;

  const best = scored[0];
  const second = scored[1];
  if (best.score > second.score) {
    return best.element;
  }

  return null;
}

function getEditCandidateContextText(element) {
  const parts = [];
  let current = element;
  let depth = 0;

  while (current && current !== document.body && depth < 5) {
    const text = getVisibleText(current).toLowerCase();
    if (text) parts.push(text);
    current = current.parentElement;
    depth++;
  }

  return parts.join(" | ");
}

function chooseBestCandidateByNextStepContext(step, elements) {
  const tokens = extractNextStepContextTokens(step);
  if (!tokens.length || !elements || elements.length < 2) return null;

  const scored = elements
    .map((element) => {
      const contextText = getEditCandidateContextText(element);
      const score = tokens.reduce(
        (total, token) => total + (contextText.includes(token) ? token.length : 0),
        0,
      );
      return { element, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0 || scored[0].score <= 0) return null;
  if (scored.length === 1 || scored[0].score > scored[1].score) {
    return scored[0].element;
  }

  return null;
}

function chooseBestEditButtonCandidate(step, elements) {
  if (!elements || elements.length === 0) return null;
  if (elements.length === 1) return elements[0];

  return (
    chooseBestCandidateByParentContext(step, elements) ||
    chooseBestCandidateByNextStepContext(step, elements) ||
    chooseBestCandidateByRecordedRect(step, elements) ||
    resolveAmbiguousCandidates(step, elements, "edit-candidate-pool", "matched multiple edit candidates") ||
    chooseTopmostElement(elements)
  );
}

function locateEditButtonWithAriaAndXPath(step, selectors) {
  if (!isEditButtonClickStep(step) || !Array.isArray(selectors)) {
    return null;
  }

  const normalizedSelectors = selectors
    .map((group) => (Array.isArray(group) ? group[0] : group))
    .filter((selector) => typeof selector === "string");

  const contextualXPathSelectors = normalizedSelectors.filter(isContextualEditXPath);
  const ariaSelectors = normalizedSelectors.filter((selector) =>
    selector.startsWith("aria/"),
  );

  for (const selector of contextualXPathSelectors) {
    const matches = prioritizeCurrentOverlayMatches(
      getElementsByXPath(selector.slice(6)),
    ).filter((element) => isElementVisible(element) && hasEditLikeSignal(element));

    const best = chooseBestEditButtonCandidate(step, matches);
    if (best) {
      logExecution(
        `Resolved edit button using contextual XPath selector ${selector}`,
        "info",
      );
      logSelectorSuccess(selector, best);
      return best;
    }
  }

  for (const selector of ariaSelectors) {
    const { name: ariaText, role: ariaRole } = parseAriaSelector(selector.slice(5));
    let matches = prioritizeCurrentOverlayMatches(
      findAllByAriaLabel(ariaText),
    ).filter((element) => isElementVisible(element) && hasEditLikeSignal(element));

    if (ariaRole && matches.length > 0) {
      const roleFiltered = matches.filter((element) =>
        elementMatchesRole(element, ariaRole),
      );
      if (roleFiltered.length > 0) {
        matches = roleFiltered;
      }
    }

    const best = chooseBestEditButtonCandidate(step, matches);
    if (best) {
      logExecution(`Resolved edit button using ARIA selector ${selector}`, "info");
      logSelectorSuccess(selector, best);
      return best;
    }
  }

  const allEditCandidates = prioritizeCurrentOverlayMatches(
    Array.from(
      document.querySelectorAll(
        'button, [role="button"], a, [tabindex], .MuiIconButton-root',
      ),
    ),
  ).filter((element) => isElementVisible(element) && hasEditLikeSignal(element));

  const best = chooseBestEditButtonCandidate(step, allEditCandidates);
  if (best) {
    logExecution(
      `Resolved edit button from generic edit-candidate pool (${allEditCandidates.length} candidates)`,
      "info",
    );
    return best;
  }

  return null;
}

function resolveAmbiguousCandidates(step, elements, selector, logContext) {
  if (!elements || elements.length === 0) return null;
  if (elements.length === 1) return elements[0];

  const rectMatched = chooseBestCandidateByRecordedRect(step, elements);
  if (rectMatched) {
    logExecution(
      `Strategy ${selector} ${logContext}, resolved using recorded position/size`,
      "info",
    );
    return rectMatched;
  }

  const overlayEl = preferOverlayElement(elements);
  if (overlayEl) {
    logExecution(
      `Strategy ${selector} ${logContext}, resolved to overlay element`,
      "info",
    );
    return overlayEl;
  }

  return null;
}

function snapshotVisibleOverlays() {
  return getVisibleOverlayCandidates();
}

function resolveNewOverlayFromSnapshot(previousOverlays) {
  const currentOverlays = getVisibleOverlayCandidates();
  if (currentOverlays.length === 0) {
    pinnedOverlayElement = null;
    return null;
  }

  const previousSet = new Set(previousOverlays || []);
  const newlyOpened = currentOverlays.filter((overlay) => !previousSet.has(overlay));
  const resolved = chooseTopmostElement(
    newlyOpened.length > 0 ? newlyOpened : currentOverlays,
  );

  pinnedOverlayElement = resolved || null;
  lastActiveOverlayElement = resolved || lastActiveOverlayElement;
  return pinnedOverlayElement;
}

/**
 * When multiple visible elements match a selector, prefer the one inside
 * the topmost overlay (modal, popover, dropdown, drawer).
 * Uses z-index first, then document.activeElement as tiebreaker (MUI traps
 * focus in the frontmost modal, so activeElement identifies the correct overlay).
 * @param {Array<HTMLElement>} visibleElements
 * @returns {HTMLElement|null}
 */
function preferOverlayElement(visibleElements) {
  if (!visibleElements || visibleElements.length < 2) return null;
  const inOverlay = visibleElements.filter(isInsideOverlay);
  if (inOverlay.length === 1) return inOverlay[0];
  if (inOverlay.length > 1) {
    // Step 1: Find the max z-index for each candidate
    const withZ = inOverlay.map((el) => {
      let maxZ = -1;
      let current = el.parentElement;
      while (current && current !== document.body) {
        const z = parseInt(window.getComputedStyle(current).zIndex, 10);
        if (!isNaN(z) && z > maxZ) maxZ = z;
        current = current.parentElement;
      }
      return { el, maxZ };
    });

    // Step 2: Find overall highest z-index
    const highestZ = Math.max(...withZ.map((x) => x.maxZ));
    const topCandidates = withZ.filter((x) => x.maxZ === highestZ);

    // Step 3: If only one candidate has the highest z-index, return it
    if (topCandidates.length === 1) return topCandidates[0].el;

    // Step 4: Tiebreaker — use document.activeElement.
    // MUI traps focus inside the frontmost modal. The candidate whose
    // overlay ancestor CONTAINS document.activeElement is in the active modal.
    const active = document.activeElement;
    if (active && active !== document.body) {
      const inActiveModal = topCandidates.find(({ el }) => {
        // Walk up from el to find its overlay container, then check if it contains activeElement
        let current = el.parentElement;
        while (current && current !== document.body) {
          const role = (current.getAttribute("role") || "").toLowerCase();
          const cls = current.className || "";
          const isOverlay =
            ["dialog", "alertdialog", "presentation"].includes(role) ||
            current.tagName === "DIALOG" ||
            (typeof cls === "string" &&
              /\b(MuiModal|MuiDrawer|MuiDialog|MuiPopover)\b/i.test(cls));
          if (isOverlay && current.contains(active)) return true;
          current = current.parentElement;
        }
        return false;
      });
      if (inActiveModal) return inActiveModal.el;
    }

    return chooseTopmostElement(topCandidates.map((candidate) => candidate.el));
  }
  return null;
}

/**
 * Checks if an element matches a given ARIA role.
 * Considers both explicit role attribute and implicit roles from HTML tags.
 * @param {HTMLElement} element
 * @param {string} role - The ARIA role to check against
 * @returns {boolean}
 */
function elementMatchesRole(element, role) {
  if (!element || !role) return false;

  // Check explicit role attribute
  const explicitRole = element.getAttribute("role");
  if (explicitRole === role) return true;

  // Map ARIA roles to implicit HTML tags
  const roleToTags = {
    button: ["BUTTON"],
    link: ["A"],
    textbox: ["INPUT", "TEXTAREA"],
    combobox: ["SELECT", "INPUT"],
    checkbox: ["INPUT"],
    radio: ["INPUT"],
    searchbox: ["INPUT"],
    spinbutton: ["INPUT"],
    slider: ["INPUT"],
    img: ["IMG"],
    heading: ["H1", "H2", "H3", "H4", "H5", "H6"],
    list: ["UL", "OL"],
    listitem: ["LI"],
    navigation: ["NAV"],
    form: ["FORM"],
    table: ["TABLE"],
    dialog: ["DIALOG"],
    option: ["OPTION"],
    menuitem: ["LI"],
    tab: [],
  };

  const validTags = roleToTags[role];
  if (validTags && validTags.includes(element.tagName)) {
    // For INPUT elements, check type for more specific roles
    if (element.tagName === "INPUT") {
      const type = (element.type || "text").toLowerCase();
      if (role === "checkbox") return type === "checkbox";
      if (role === "radio") return type === "radio";
      if (role === "searchbox") return type === "search";
      if (role === "spinbutton") return type === "number";
      if (role === "slider") return type === "range";
      if (role === "textbox")
        return ["text", "email", "tel", "url", "password", ""].includes(type);
      if (role === "combobox") return type === "text" || type === "search";
    }
    return true;
  }

  return false;
}
/**
 * Extracts a search-friendly term from a step's selectors/target to type
 * into a search field when a dropdown option isn't immediately visible.
 * Handles patterns like "aria/GSTIN: 27AAICT9043M1ZP - Maharashtra" or
 * "aria/BATXO INFO SUPPORT SERVICE".
 */
function extractSearchTermFromStep(step) {
  // Get the primary selector target
  let label = null;

  // Check step.selector or step.target for aria/ prefix
  const target = step.selector || step.target || "";
  if (target.startsWith("aria/")) {
    label = extractAriaName(target.substring(5));
  }

  // Also check selectors array for aria patterns
  if (!label && step.selectors) {
    const selectors = Array.isArray(step.selectors) ? step.selectors : [];
    for (const sel of selectors) {
      const s = Array.isArray(sel) ? sel[0] : sel;
      if (typeof s === "string" && s.startsWith("aria/")) {
        label = extractAriaName(s.substring(5));
        break;
      }
    }
  }

  if (!label) return null;

  // Do not extract search terms for date picker options or generic UI actions
  if (
    label.startsWith("Choose ") ||
    label.includes("202") ||
    /^(add|edit|delete|remove|select|cancel|submit|save|close)/i.test(label)
  ) {
    return null;
  }

  // Extract a meaningful search term from the label
  // Pattern: "GSTIN: XXXXX - State" -> extract the GSTIN code
  const gstinMatch = label.match(/GSTIN:\s*(\S+)/i);
  if (gstinMatch) return gstinMatch[1];

  // Pattern: "XXXXX Supplier/Customer" -> use first word(s) as search
  // Take the first meaningful word (3+ chars) as search term
  const words = label.split(/\s+/).filter((w) => w.length >= 3);
  if (words.length > 0) {
    // Use first word as search term (enough to filter dropdowns)
    return words[0];
  }

  return null;
}

/**
 * Verifies that an element exists or contains specific text.
 * @param {Object} step
 */
async function verifyAssertion(step) {
  const element = locateElement(step);

  if (step.action === "assertExists") {
    if (!element || !isElementVisible(element)) {
      throw new Error(
        `Assertion Failed: Element not found or not visible for: ${step.description}`,
      );
    }
    highlightElement(element);
    return true;
  }

  if (step.action === "assertText") {
    if (!element) {
      throw new Error(
        `Assertion Failed: Element not found for: ${step.description}`,
      );
    }
    const actualText = getVisibleText(element)
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const expectedText = (step.selectors?.innerText || step.description || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    if (!actualText.includes(expectedText)) {
      throw new Error(
        `Assertion Failed: Expected text "${expectedText}" but found "${actualText}"`,
      );
    }
    highlightElement(element);
    return true;
  }
  return false;
}

/**
 * Safely executes querySelectorAll and returns an array of elements.
 * Prevents crashes on invalid selectors (e.g. Playwright prefixes).
 */
function safeQuerySelectorAll(selector, root = document) {
  if (!selector || typeof selector !== "string") return [];

  // Quick prevent for common invalid playwright-style selectors
  if (
    selector.startsWith("aria/") ||
    selector.startsWith("xpath/") ||
    selector.startsWith("//")
  ) {
    return [];
  }

  try {
    return Array.from(root.querySelectorAll(selector));
  } catch (e) {
    return [];
  }
}

/**
 * Checks if a step is likely targeting an option in a combobox or listbox.
 */
function isStepTargetingOption(step) {
  if (step.action !== "click") return false;

  const isOptionSelector = step.selectors?.some((grp) => {
    const s = Array.isArray(grp) ? grp[0] : grp;
    return (
      typeof s === "string" &&
      (s.includes('[role="option"]') ||
        s.includes("slds-listbox__item") ||
        s.includes("react-datepicker__day"))
    );
  });

  if (isOptionSelector) return true;

  // ARIA labels for options often look like "Value" or "Label: Value"
  // But they can also be checkboxes. We check for common option prefixes or types.
  const target = step.selector || step.target || "";
  if (target.startsWith("aria/")) {
    const label = extractAriaName(target.slice(5));
    // Common date patterns
    if (label.startsWith("Choose ") && label.includes("202")) return true;
    // GSTIN or SKU patterns are often options
    if (
      label.includes("GSTIN:") ||
      label.includes("SKU:") ||
      label.includes("Plant:") ||
      label.includes(" - ") ||
      (label.length > 0 && label.length < 40 && !label.includes("/"))
    )
      return true;
  }

  return false;
}

/**
 * Checks if a step is likely targeting a date picker element.
 */
function isStepTargetingDate(step) {
  const target = step.selector || step.target || "";
  const desc = (step.description || "").toLowerCase();
  const isGridDay = target.includes("gridcell") && /^\d+$/.test(desc.trim());
  return (
    target.includes("datepicker__day") ||
    (desc.startsWith("choose ") && desc.includes("202")) ||
    desc.includes("date") ||
    desc.includes("calendar") ||
    isGridDay
  );
}

function locateElement(step, attempt = 0) {
  let element = null;
  getTopmostActiveOverlay();

  // 1. Try new selector array format (or nested selectors object)
  const selectorArray = Array.isArray(step.selectors)
    ? step.selectors
    : Array.isArray(step.selectors?.selectors)
      ? step.selectors.selectors
      : null;
  if (selectorArray && selectorArray.length > 0) {
    if (isEditButtonClickStep(step)) {
      element = locateEditButtonWithAriaAndXPath(step, selectorArray);
    }

    const stepWithArray =
      selectorArray === step.selectors
        ? step
        : { ...step, selectors: selectorArray };
    if (!element) {
      element = locateElementWithSelectorArray(stepWithArray, attempt);
    }
  }

  // 2. Try legacy single selector if array fails or is missing
  if (!element) {
    element = locateElementLegacy(step);
  }

  // 3. Try fuzzy search as last resort before giving up
  if (!element) {
    element = fuzzyFallbackSearch(step);
  }

  // 4. Try deep shadow DOM search for the main selector (only return visible)
  if (!element && step.target) {
    const target = step.target;
    // Don't pass prefixed ones to querySelector
    if (
      !target.startsWith("aria/") &&
      !target.startsWith("xpath/") &&
      !target.startsWith("//")
    ) {
      const shadowEl = deepQuerySelector(target);
      if (shadowEl && isElementVisible(shadowEl)) {
        element = shadowEl;
      }
    }
  }

  return element;
}

function isEditTargetingStep(step) {
  if (!step) return false;

  const texts = [
    step.description,
    step.target,
    step.selector,
    ...(Array.isArray(step.selectors)
      ? step.selectors.map((entry) => (Array.isArray(entry) ? entry[0] : entry))
      : []),
  ]
    .filter((value) => typeof value === "string")
    .map((value) => value.toLowerCase());

  return texts.some((value) => value.includes("edit"));
}

function isButtonClickStep(step) {
  if (!step || step.action !== "click") return false;
  return (step.tagName || "").toUpperCase() === "BUTTON";
}

function isEditButtonClickStep(step) {
  return isButtonClickStep(step) && isEditTargetingStep(step);
}

function isContextualEditXPath(selector) {
  if (!selector || typeof selector !== "string") return false;
  const normalized = selector.toLowerCase();
  return (
    normalized.startsWith("xpath/") &&
    normalized.includes("ancestor::*") &&
    normalized.includes("edit")
  );
}

function isGenericEditAriaSelector(selector) {
  if (!selector || typeof selector !== "string") return false;
  const normalized = selector.toLowerCase().trim();
  return (
    normalized === "aria/edit" ||
    normalized === "aria/button[edit]" ||
    normalized === "aria/i[edit]"
  );
}

function isAbsoluteXPathSelector(selector) {
  if (!selector || typeof selector !== "string") return false;
  const normalized = selector.toLowerCase();
  return (
    normalized.startsWith("xpath///*") ||
    normalized.startsWith("xpath////") ||
    normalized.includes("/html/body/")
  );
}

function getStepSelectorPriority(selector, step) {
  if (!selector || typeof selector !== "string") return 100;

  const normalized = selector.toLowerCase();

  if (isEditButtonClickStep(step)) {
    if (isContextualEditXPath(selector)) return 0;
    if (normalized.startsWith("aria/")) return 1;
    if (normalized.includes("#") || normalized.includes("[data-")) return 10;
    if (normalized.startsWith("xpath/") && !isAbsoluteXPathSelector(selector))
      return 20;
    if (normalized.startsWith("css") || normalized.includes(">")) return 30;
    if (normalized.includes(":nth-of-type")) return 40;
    if (isAbsoluteXPathSelector(selector)) return 50;
    return 35;
  }

  if (isContextualEditXPath(selector)) {
    return 0;
  }

  if (isEditTargetingStep(step) && !isButtonClickStep(step)) {
    if (
      normalized.includes("card-row-") ||
      normalized.includes("button.btn-text") ||
      normalized.includes("material-icons")
    ) {
      return 1;
    }
    if (normalized.startsWith("xpath/") && !isAbsoluteXPathSelector(selector)) {
      return 5;
    }
    if (normalized.includes("#") || normalized.includes("[data-")) {
      return 10;
    }
    if (isGenericEditAriaSelector(selector)) {
      return 90;
    }
  }

  if (
    normalized.startsWith("xpath/") &&
    (normalized.includes("billing") ||
      normalized.includes("shipping") ||
      normalized.includes("address") ||
      normalized.includes("company") ||
      normalized.includes("plant"))
  ) {
    return 1;
  }

  if (isGenericEditAriaSelector(selector)) return 90;
  if (normalized.startsWith("aria/") && normalized.includes("edit")) return 5;
  if (normalized.startsWith("xpath/")) return 10;
  if (normalized.includes("#") || normalized.includes("[data-")) return 20;
  if (normalized.includes(":nth-of-type")) return 40;
  return 30;
}

function prioritizeSelectorsForStep(selectorGroups, step) {
  if (!Array.isArray(selectorGroups) || selectorGroups.length <= 1) {
    return selectorGroups;
  }

  if (!isEditTargetingStep(step)) {
    return selectorGroups;
  }

  return selectorGroups
    .map((group, index) => ({
      group,
      index,
      selector: Array.isArray(group) ? group[0] : group,
    }))
    .sort((a, b) => {
      const priorityDiff =
        getStepSelectorPriority(a.selector, step) -
        getStepSelectorPriority(b.selector, step);
      if (priorityDiff !== 0) return priorityDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.group);
}

/**
 * Locates element using new selector array format with Shadow DOM support.
 * @param {Object} step
 * @returns {HTMLElement|null}
 */
function locateElementWithSelectorArray(step, attempt = 0) {
  const selectors = prioritizeSelectorsForStep(step.selectors, step);

  // WEIGHTED STRATEGY: During the first 2 seconds (8 attempts), prefer "specific" selectors
  // like IDs or unique ARIA names.
  // ONLY apply this if the step actually HAS specific selectors. If it only has
  // weak positional ones, we shouldn't wait.
  const hasSpecificSelectors = selectors.some((s) =>
    isSpecificSelector(Array.isArray(s) ? s[0] : s),
  );
  const isTransitionPhase = attempt < 8 && hasSpecificSelectors;

  for (const selectorGroup of selectors) {
    const selector = Array.isArray(selectorGroup)
      ? selectorGroup[0]
      : selectorGroup;

    if (!selector || typeof selector !== "string") continue;

    // During transition phase, skip weak/positional selectors ONLY IF we have better options
    if (isTransitionPhase && !isSpecificSelector(selector)) {
      continue;
    }

    try {
      let el = null;

      // ARIA Selector (format: "aria/Name" or "aria/role[Name]")
      if (selector.startsWith("aria/")) {
        // Handle nested selectors like "aria/Dialog[Settings] >> aria/button[Save]"
        if (selector.includes(" >> ")) {
          const parts = selector.split(" >> ");
          let context = document;
          let el = null;

          for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const { name: ariaText, role: ariaRole } = parseAriaSelector(
              part.startsWith("aria/") ? part.slice(5) : part,
            );

            const results = findAllByAriaLabel(ariaText, context);
            const visibleResults = prioritizeCurrentOverlayMatches(
              results,
            ).filter(isElementVisible);

            if (ariaRole && visibleResults.length > 0) {
              const roleFiltered = visibleResults.filter((e) =>
                elementMatchesRole(e, ariaRole),
              );
              if (roleFiltered.length > 0) {
                el = chooseTopmostElement(roleFiltered);
              } else {
                el = chooseTopmostElement(visibleResults);
              }
            } else if (visibleResults.length > 0) {
              el = chooseTopmostElement(visibleResults);
            } else {
              el = null;
              break;
            }
            context = el;
          }

          if (el) {
            logSelectorSuccess(selector, el);
            return el;
          }
          continue;
        }

        const { name: ariaText, role: ariaRole } = parseAriaSelector(
          selector.slice(5),
        );
        if (isGenericIconAria(ariaText)) {
          logExecution(
            `Skipping generic aria icon selector ${selector}`,
            "info",
          );
          continue;
        }
        let elements = findAllByAriaLabel(ariaText);
        elements = prioritizeCurrentOverlayMatches(elements);

        // If a role was specified (e.g. aria/textbox[Label]), filter by role
        if (ariaRole && elements.length > 0) {
          const roleFiltered = elements.filter((e) =>
            elementMatchesRole(e, ariaRole),
          );
          if (roleFiltered.length > 0) {
            elements = roleFiltered;
          } else {
            logExecution(
              `Strategy ${selector} found ${elements.length} elements but none matched role "${ariaRole}", trying without role filter`,
              "info",
            );
          }
        }

        // Strategy: 1. Visible and matches step description text
        // 2. Visible (only if unique match)
        // 3. Skip if ambiguous — let more specific selectors handle it
        const expectedText = (
          step.description ||
          step.selectors?.innerText ||
          ""
        )
          .toLowerCase()
          .trim();
        const visibleElements = elements.filter(isElementVisible);

        if (expectedText && expectedText.length > 2) {
          const textMatches = visibleElements.filter((e) => {
            const text = getVisibleText(e).toLowerCase().trim();
            return text === expectedText || text.includes(expectedText);
          });
          if (textMatches.length === 1) {
            el = textMatches[0];
          } else if (textMatches.length > 1) {
            el = resolveAmbiguousCandidates(
              step,
              textMatches,
              selector,
              `found ${textMatches.length} text matches for "${expectedText}"`,
            );
            if (!el) {
              logExecution(
                `Strategy ${selector} found ${textMatches.length} text matches for "${expectedText}", skipping ambiguous match`,
                "info",
              );
              continue;
            }
          }
        }

        // If we have exactly 1 visible match, use it
        if (!el && visibleElements.length === 1) {
          el = visibleElements[0];
        }
        // If many visible matches and text didn't disambiguate, skip to let
        // more specific selectors (XPath with ID, CSS) win
        if (!el && visibleElements.length > 1) {
          el = resolveAmbiguousCandidates(
            step,
            visibleElements,
            selector,
            `found ${visibleElements.length} visible elements`,
          );
          if (!el) {
            logExecution(
              `Strategy ${selector} found ${visibleElements.length} visible elements, skipping ambiguous match`,
              "info",
            );
            continue;
          }
        }

        if (el) {
          logSelectorSuccess(selector, el);
          return el;
        } else {
          logExecution(
            `Strategy ${selector} found NO matching elements`,
            "info",
          );
        }
      }
      // XPath selector
      else if (selector.startsWith("xpath/")) {
        const xpath = selector.slice(6);
        const els = getElementsByXPath(xpath);
        const prioritizedXPathEls = prioritizeCurrentOverlayMatches(els);

        // Similar priority strategy for XPath
        const expectedText = (step.description || "").toLowerCase().trim();
        const visibleElements = prioritizedXPathEls.filter(isElementVisible);

        if (expectedText && expectedText.length > 2) {
          const textMatches = visibleElements.filter((e) => {
            const text = getVisibleText(e).toLowerCase().trim();
            return text === expectedText || text.includes(expectedText);
          });
          if (textMatches.length === 1) {
            el = textMatches[0];
          } else if (textMatches.length > 1) {
            el = resolveAmbiguousCandidates(
              step,
              textMatches,
              selector,
              `found ${textMatches.length} XPath text matches for "${expectedText}"`,
            );
            if (!el) {
              logExecution(
                `Strategy ${selector} found ${textMatches.length} XPath text matches for "${expectedText}", skipping ambiguous match`,
                "info",
              );
              continue;
            }
          }
        }

        // If unique visible match, use it
        if (!el && visibleElements.length === 1) {
          el = visibleElements[0];
        }
        // If ambiguous (multiple visible matches), skip to more specific selectors
        if (!el && visibleElements.length > 1) {
          el = resolveAmbiguousCandidates(
            step,
            visibleElements,
            selector,
            `found ${visibleElements.length} visible elements`,
          );
          if (!el) {
            logExecution(
              `Strategy ${selector} found ${visibleElements.length} visible elements, skipping ambiguous match`,
              "info",
            );
            continue;
          }
        }

        if (el) {
          logSelectorSuccess(selector, el);
          return el;
        } else if (els.length > 0) {
          logExecution(
            `Strategy ${selector} found ${els.length} elements but none were visible`,
            "warning",
          );
        } else {
          logExecution(
            `Strategy ${selector} found NO matching elements`,
            "info",
          );
        }
      }
      // CSS selector (default)
      else {
        // Try normal first
        const elements = safeQuerySelectorAll(selector);
        const prioritizedElements = prioritizeCurrentOverlayMatches(elements);

        // Strategy: 1. Visible and matches text description
        // 2. Visible
        // 3. Just the first one
        const expectedText = (step.description || "").toLowerCase().trim();

        if (expectedText && expectedText.length > 2) {
          const visibleMatches = prioritizedElements.filter(isElementVisible);
          const textMatches = visibleMatches.filter((e) => {
            const descriptor = getElementDescriptor(e);
            const visibleText = getVisibleText(e);
            return (
              textMatchesExpected(expectedText, descriptor) ||
              textMatchesExpected(expectedText, visibleText)
            );
          });

          if (textMatches.length === 1) {
            el = textMatches[0];
          } else if (textMatches.length > 1) {
            // Resolve ambiguity: prefer interactive elements over generic ones
            const interactiveElements = textMatches.filter((e) => {
              const role = e.getAttribute("role");
              const isInteractiveRole = [
                "button",
                "link",
                "checkbox",
                "menuitem",
                "option",
                "radio",
                "switch",
                "tab",
                "textbox",
                "combobox",
                "listbox",
                "searchbox",
              ].includes(role);
              const isInteractiveTag = [
                "BUTTON",
                "INPUT",
                "SELECT",
                "A",
                "TEXTAREA",
              ].includes(e.tagName);
              return isInteractiveRole || isInteractiveTag;
            });
            if (interactiveElements.length === 1) {
              logExecution(
                `Strategy ${selector} matched ${textMatches.length} elements, preferring interactive element/role match`,
                "info",
              );
              el = interactiveElements[0];
            } else {
              el = resolveAmbiguousCandidates(
                step,
                interactiveElements.length > 1 ? interactiveElements : textMatches,
                selector,
                `matched ${textMatches.length} elements for description "${expectedText}"`,
              );
            }
            if (!el) {
              logExecution(
                `Strategy ${selector} matched ${textMatches.length} elements for description "${expectedText}", skipping ambiguous match`,
                "info",
              );
              continue;
            }
          } else if (
            isSpecificSelector(selector) &&
            visibleMatches.length === 1 &&
            step.action === "input"
          ) {
            // Only allow relaxed text match for INPUT steps (handles dynamic placeholders)
            // For CLICK steps, we must be strict about the text.
            el = visibleMatches[0];
          } else if (visibleMatches.length > 0) {
            logExecution(
              `Strategy ${selector} found ${visibleMatches.length} elements but none matched "${expectedText}"${step.action !== "input" ? " (skipping because it is a click step)" : ""}`,
              "info",
            );
          }
        }

        // If this is a generic selector and multiple visible matches exist,
        // skip it to let more specific selectors (XPath, full CSS path) win.
        if (!el) {
          const visibleList = prioritizedElements.filter(isElementVisible);
          if (visibleList.length === 1) {
            el = visibleList[0];
          } else if (visibleList.length > 1) {
            el = resolveAmbiguousCandidates(
              step,
              visibleList,
              selector,
              `matched ${visibleList.length} visible elements`,
            );
            if (!el) {
              logExecution(
                `Strategy ${selector} matched ${visibleList.length} visible elements, skipping ambiguous selector`,
                "info",
              );
              continue; // Force fallback to next selector (e.g. XPath)
            }
          }
        }

        // Try deep shadow if not found — but only return if visible
        if (!el) {
          const shadowEl = deepQuerySelector(selector);
          if (shadowEl && isElementVisible(shadowEl)) {
            el = shadowEl;
          }
        }

        if (el) {
          logSelectorSuccess(selector, el);
          return el;
        } else if (elements.length > 0) {
          logExecution(
            `Strategy ${selector} found ${elements.length} elements but none were visible`,
            "warning",
          );
        } else {
          logExecution(
            `Strategy ${selector} found NO matching elements`,
            "info",
          );
        }
      }
    } catch (e) {
      logExecution(
        `Selector strategy failed: ${selector} - ${e.message}`,
        "error",
      );
    }
  }

  // --- DYNAMIC COMBOBOX/DATE FALLBACK ---
  if (isStepTargetingOption(step) || isStepTargetingDate(step)) {
    const activeContainer = document.querySelector(
      '[role="listbox"]:not([style*="display: none"]), .slds-dropdown:not([style*="display: none"]), .selectV2-portal:not([style*="display: none"]), .react-datepicker:not([style*="display: none"]), .absolute-positioned:not([style*="display: none"]), .MuiPopover-root:not([style*="display: none"]), .MuiPopper-root:not([style*="display: none"]), .MuiDialog-root:not([style*="display: none"])',
    );

    if (activeContainer) {
      const anyVisibleOption = Array.from(
        activeContainer.querySelectorAll(
          '[role="option"], [role="gridcell"], li.slds-listbox__item, .react-datepicker__day:not(.react-datepicker__day--disabled):not(.react-datepicker__day--outside-month), .MuiPickersDay-root:not(.Mui-disabled), .MuiMenuItem-root',
        ),
      ).find(isElementVisible);

      if (anyVisibleOption) {
        logExecution(
          `Attempting context-aware dynamic fallback for missing recorded item: ${step.description || step.target}`,
          "success",
        );
        return anyVisibleOption;
      }
    }
  }

  return null;
}

/**
 * Finds all elements by ARIA label (accessible name).
 * @param {string} ariaText
 * @param {Element|Document} root - Scopes the search to this element
 * @returns {Array<HTMLElement>}
 */
function findAllByAriaLabel(ariaText, root = document) {
  if (!ariaText) return [];
  const normalizedSearch = ariaText.replace(/\s+/g, " ").trim().toLowerCase();
  const matches = [];

  const allElements = root.querySelectorAll("*");
  for (const el of allElements) {
    let matched = false;

    // 1. aria-label
    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel && ariaLabel.trim().toLowerCase() === normalizedSearch) {
      matched = true;
    }

    // 2. aria-labelledby
    if (!matched) {
      const ariaLabelledBy = el.getAttribute("aria-labelledby");
      if (ariaLabelledBy) {
        const labelEl = document.getElementById(ariaLabelledBy);
        if (labelEl) {
          const labelText = getVisibleText(labelEl).trim().toLowerCase();
          if (labelText === normalizedSearch) matched = true;
        }
      }
    }

    // 3. connected label
    if (!matched && el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) {
        const labelText = getVisibleText(label).trim().toLowerCase();
        if (labelText === normalizedSearch) matched = true;
      }
    }

    // 4. Wrap label
    if (!matched) {
      const wrapLabel = el.closest("label");
      if (wrapLabel) {
        const labelText = getVisibleText(wrapLabel).trim().toLowerCase();
        if (labelText === normalizedSearch) matched = true;
      }
    }

    // 5. Role/TagName text
    if (!matched) {
      const role = el.getAttribute("role");
      const interactiveTags = ["BUTTON", "A", "SELECT", "INPUT", "TEXTAREA"];
      const interactiveRoles = [
        "button",
        "link",
        "menuitem",
        "tab",
        "option",
        "radio",
        "checkbox",
      ];
      if (
        interactiveTags.includes(el.tagName) ||
        (role && interactiveRoles.includes(role))
      ) {
        const text = getVisibleText(el)
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        if (text === normalizedSearch) matched = true;

        // Support for checkbox/radio options wrapped in divs
        if (
          !matched &&
          (el.tagName === "INPUT" || role === "checkbox" || role === "radio")
        ) {
          let currentListboxItem = el.parentElement;
          let depth = 0;
          while (currentListboxItem && depth < 4) {
            if (
              currentListboxItem.classList.contains("optionLabel") ||
              currentListboxItem.getAttribute("role") === "option" ||
              currentListboxItem.classList.contains("MuiMenuItem-root")
            ) {
              const itemText = getVisibleText(currentListboxItem)
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
              if (itemText === normalizedSearch) {
                matched = true;
                break;
              }
            }
            currentListboxItem = currentListboxItem.parentElement;
            depth++;
          }
        }
      }
    }

    // 6. Placeholder
    if (!matched && el.hasAttribute("placeholder")) {
      const placeholder = el
        .getAttribute("placeholder")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      if (placeholder === normalizedSearch) matched = true;
    }

    if (matched) matches.push(el);
  }

  return matches;
}

/**
 * Finds element by ARIA label (accessible name).
 * @param {string} ariaText
 * @returns {HTMLElement|null}
 */
function findByAriaLabel(ariaText) {
  const matches = prioritizeCurrentOverlayMatches(findAllByAriaLabel(ariaText));
  return matches.find(isElementVisible) || matches[0] || null;
}

/**
 * Legacy locator for backward compatibility.
 * @param {Object} step
 * @returns {HTMLElement|null}
 */
function locateElementLegacy(step) {
  const { targets, target, selectors, selector, selectorType } = step;

  const activeTargets = [];

  // 1. Build a list of candidate locators (Normalizing new and old formats)
  if (targets && Array.isArray(targets)) {
    targets.forEach((t) => {
      if (typeof t === "object" && t.type && t.value) {
        // New structure: {type, value}
        activeTargets.push({ type: t.type, value: t.value });
      } else if (Array.isArray(t) && t.length >= 1) {
        // Transition structure: ["prefix=value", "type"]
        const parts = t[0].split("=");
        if (parts.length >= 2) {
          activeTargets.push({
            type: parts[0],
            value: t[0].slice(parts[0].length + 1),
          });
        }
      }
    });
  }

  // Handle high-level target/selector fields
  if (selector && selectorType) {
    activeTargets.unshift({ type: selectorType, value: selector });
  } else if (target && typeof target === "string") {
    if (target.includes("=")) {
      // Old Selenium style string: "type=value"
      const parts = target.split("=");
      activeTargets.unshift({
        type: parts[0],
        value: target.slice(parts[0].length + 1),
      });
    } else {
      // Raw string: check for Playwright-style prefixes
      if (target.startsWith("aria/")) {
        activeTargets.unshift({
          type: "aria",
          value: extractAriaName(target.slice(5)),
        });
      } else if (target.startsWith("xpath/")) {
        activeTargets.unshift({ type: "xpath", value: target.slice(6) });
      } else if (target.startsWith("//")) {
        activeTargets.unshift({ type: "xpath", value: target });
      } else {
        // Raw string: assume CSS
        activeTargets.unshift({ type: "css", value: target });
      }
    }
  }

  if (
    (isEditTargetingStep(step) || isButtonClickStep(step)) &&
    activeTargets.length > 1
  ) {
    activeTargets.sort((a, b) => {
      const priorityDiff =
        getStepSelectorPriority(a.value, step) -
        getStepSelectorPriority(b.value, step);
      if (priorityDiff !== 0) return priorityDiff;
      return 0;
    });
  }

  // 2. Try each locator strategy
  for (const locator of activeTargets) {
    try {
      let el = null;
      const { type, value } = locator;
      const normalizedValue = normalizeSelectorValue(type, value);

      if (type === "id") {
        const elements = prioritizeCurrentOverlayMatches(
          Array.from(
            document.querySelectorAll(
          `[id="${CSS.escape(normalizedValue)}"]`,
            ),
          ),
        );
        for (const candidate of elements) {
          if (isElementVisible(candidate)) {
            el = candidate;
            break;
          }
        }
      } else if (type === "css" || type === "css:finder") {
        const elements = prioritizeCurrentOverlayMatches(
          safeQuerySelectorAll(normalizedValue),
        );
        const expectedText = (
          step.description ||
          step.selectors?.innerText ||
          ""
        )
          .toLowerCase()
          .trim();

        if (expectedText && expectedText.length > 2) {
          const visibleMatches = elements.filter(isElementVisible);
          const textMatches = visibleMatches.filter((e) => {
            const text = getElementDescriptor(e) || getVisibleText(e);
            return textMatchesExpected(expectedText, text);
          });

          if (textMatches.length === 1) {
            el = textMatches[0];
          } else if (textMatches.length > 1) {
            logExecution(
              `Legacy strategy ${type} matched ${textMatches.length} elements for text "${expectedText}", skipping ambiguous match`,
              "info",
            );
            continue;
          } else if (
            isSpecificSelector(normalizedValue) &&
            visibleMatches.length === 1
          ) {
            el = visibleMatches[0];
          } else {
            logExecution(
              `Legacy strategy ${type} found elements but none matched text "${expectedText}", skipping`,
              "info",
            );
            continue;
          }
        }

        if (!el) {
          for (const candidate of elements) {
            if (isElementVisible(candidate)) {
              el = candidate;
              break;
            }
          }
        }
      } else if (type === "aria") {
        const ariaName = extractAriaName(normalizedValue);
        if (isGenericIconAria(ariaName)) {
          logExecution(
            `Skipping generic aria icon selector aria/${ariaName}`,
            "info",
          );
          continue;
        }
        const ariaMatches = prioritizeCurrentOverlayMatches(
          findAllByAriaLabel(ariaName),
        ).filter(isElementVisible);
        el = chooseTopmostElement(ariaMatches) || findByAriaLabel(ariaName);
      } else if (type === "xpath" || type.startsWith("xpath:")) {
        const els = prioritizeCurrentOverlayMatches(
          getElementsByXPath(normalizedValue),
        ).filter(isElementVisible);
        if (els.length > 0) el = chooseTopmostElement(els);
      } else if (type === "linkText") {
        const links = prioritizeCurrentOverlayMatches(
          Array.from(document.getElementsByTagName("a")),
        );
        for (const link of links) {
          const lText = getVisibleText(link)
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          const vText = value.replace(/\s+/g, " ").trim().toLowerCase();
          if (lText === vText) {
            el = link;
            break;
          }
        }
      } else if (type === "name") {
        const nameMatches = prioritizeCurrentOverlayMatches(
          safeQuerySelectorAll(`[name="${CSS.escape(normalizedValue)}"]`),
        ).filter(isElementVisible);
        el = chooseTopmostElement(nameMatches);
      } else if (type === "testId") {
        const testIdMatches = prioritizeCurrentOverlayMatches(
          safeQuerySelectorAll(
            `[data-testid="${CSS.escape(normalizedValue)}"], [data-cy="${CSS.escape(normalizedValue)}"], [data-test-id="${CSS.escape(normalizedValue)}"], [data-qa="${CSS.escape(normalizedValue)}"]`,
          ),
        ).filter(isElementVisible);
        el = chooseTopmostElement(testIdMatches);
      } else if (type === "placeholder") {
        const placeholderMatches = prioritizeCurrentOverlayMatches(
          safeQuerySelectorAll(`[placeholder="${CSS.escape(normalizedValue)}"]`),
        ).filter(isElementVisible);
        el = chooseTopmostElement(placeholderMatches);
      } else if (type === "role") {
        // Parse role: button[name='Save']
        const match = normalizedValue.match(/([a-z]+)\[name='(.+?)'\]/);
        if (match) {
          const role = match[1];
          const name = match[2];
          const candidates = prioritizeCurrentOverlayMatches(
            Array.from(
              document.querySelectorAll(
                role === "textbox" ? "input, textarea" : role,
              ),
            ),
          );
          for (const candidate of candidates) {
            const cName =
              candidate.getAttribute("aria-label") ||
              candidate.innerText ||
              candidate.getAttribute("alt") ||
              "";
            if (cName.trim() === name || cName.includes(name)) {
              el = candidate;
              break;
            }
          }
        }
      }

      if (el) {
        // --- DYNAMIC DATE PICKER OVERRIDE ---
        // If the element is a React datepicker day, but the specific label (e.g. "Choose Wednesday, February 25th")
        // was requested and not found, try to just click today's date instead of failing.
        // Wait, if el is found, it's fine. We need to handle this below when NOT found.

        const isVisible = isElementVisible(el);
        const logMsg = `Playback: Strategy ${type}=${value} found ${el.tagName} (ID: ${el.id}, Visible: ${isVisible})`;
        chrome.storage.local
          .get("e2e_debug_logs")
          .then(({ e2e_debug_logs = [] }) => {
            e2e_debug_logs.push(`[${new Date().toISOString()}] ${logMsg}`);
            chrome.storage.local.set({ e2e_debug_logs });
          });

        if (isVisible && el.isConnected) return el;
      }
    } catch (e) {
      console.warn("Strategy failed:", locator, e.message);
    }
  }

  // Legacy Fallback — require visibility to avoid returning collapsed/hidden elements
  if (selectors && selectors.css) {
    const el = prioritizeCurrentOverlayMatches(
      safeQuerySelectorAll(selectors.css),
    ).find((candidate) => candidate.isConnected && isElementVisible(candidate));
    if (el && el.isConnected && isElementVisible(el)) return el;
  }

  if (selector) {
    const el = prioritizeCurrentOverlayMatches(
      safeQuerySelectorAll(selector),
    ).find((candidate) => candidate.isConnected && isElementVisible(candidate));
    if (el && el.isConnected && isElementVisible(el)) return el;
  }

  if (selectors && selectors.id) {
    const el = prioritizeCurrentOverlayMatches(
      Array.from(document.querySelectorAll(`[id="${CSS.escape(selectors.id)}"]`)),
    ).find((candidate) => candidate.isConnected && isElementVisible(candidate));
    if (el && el.isConnected && isElementVisible(el)) return el;
  }

  // --- DYNAMIC COMBOBOX/DATE FALLBACK ---
  if (isStepTargetingOption(step) || isStepTargetingDate(step)) {
    const activeContainer = document.querySelector(
      '[role="listbox"]:not([style*="display: none"]), .slds-dropdown:not([style*="display: none"]), .selectV2-portal:not([style*="display: none"]), .react-datepicker:not([style*="display: none"]), .absolute-positioned:not([style*="display: none"]), .MuiPopover-root:not([style*="display: none"]), .MuiPopper-root:not([style*="display: none"]), .MuiDialog-root:not([style*="display: none"])',
    );

    if (activeContainer) {
      const anyVisibleOption = Array.from(
        activeContainer.querySelectorAll(
          '[role="option"], [role="gridcell"], li.slds-listbox__item, .react-datepicker__day:not(.react-datepicker__day--disabled):not(.react-datepicker__day--outside-month), .MuiPickersDay-root:not(.Mui-disabled), .MuiMenuItem-root',
        ),
      ).find(isElementVisible);

      if (anyVisibleOption) {
        logExecution(
          `Attempting context-aware dynamic fallback for missing recorded item: ${step.description || step.target}`,
          "success",
        );
        return anyVisibleOption;
      }
    }
  }

  return fuzzyFallbackSearch(step);
}

/**
 * Normalizes selector values that may include Playwright-style prefixes.
 * @param {string} type
 * @param {string} value
 * @returns {string}
 */
function normalizeSelectorValue(type, value) {
  if (typeof value !== "string") return value;

  if (type === "aria" && value.startsWith("aria/")) {
    return value.slice(5);
  }

  if (type === "xpath" || type.startsWith("xpath:")) {
    if (value.startsWith("xpath/")) return value.slice(6);
  }

  return value;
}

function isGenericIconAria(text) {
  if (!text || typeof text !== "string") return false;
  const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
  const genericIcons = new Set([
    "chevron_right",
    "chevron_left",
    "expand_more",
    "expand_less",
    "west",
    "east",
    "north",
    "south",
    "menu",
    "more_vert",
    "more_horiz",
    "close",
    "add",
    "remove",
    "search",
    "filter_list",
    "delete",
    "download",
    "file_download",
    "upload",
    "refresh",
  ]);
  return genericIcons.has(normalized);
}

function isSpecificSelector(selector) {
  if (!selector || typeof selector !== "string") return false;
  if (selector.includes("#")) return true;
  // Treat context-aware edit XPath (produced by buildEditContextualXPath) as specific
  // so it is not skipped during the early transition phase.
  if (
    selector.startsWith("xpath/") &&
    selector.includes("edit") &&
    selector.includes("ancestor::*")
  )
    return true;
  return /\[(data-testid|data-cy|data-test-id|data-qa|aria-label|name)=/i.test(
    selector,
  );
}

function normalizeTextForMatch(text) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeTextLoose(text) {
  return stripIconWords(
    normalizeTextForMatch(text)
      .replace(/[\d()]+/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function textMatchesExpected(expected, actual) {
  if (!expected || !actual) return false;
  const e = normalizeTextForMatch(expected);
  const a = normalizeTextForMatch(actual);
  if (!e || !a) return false;

  if (a === e || a.includes(e) || e.includes(a)) return true;

  const eLoose = normalizeTextLoose(expected);
  const aLoose = normalizeTextLoose(actual);
  if (!eLoose || !aLoose) return false;
  return (
    aLoose === eLoose || aLoose.includes(eLoose) || eLoose.includes(aLoose)
  );
}

function stripIconWords(text) {
  if (!text) return "";
  const iconWords = [
    "chevron_right",
    "chevron_left",
    "expand_more",
    "expand_less",
    "file_download",
    "file_upload",
    "west",
    "east",
    "north",
    "south",
    "menu",
    "more_vert",
    "more_horiz",
    "close",
    "search",
    "filter_list",
    "delete",
    "download",
    "upload",
    "refresh",
  ];
  const pattern = new RegExp(`\\b(${iconWords.join("|")})\\b`, "g");
  return text.replace(pattern, "").replace(/\s+/g, " ").trim();
}

/**
 * Fuzzy fallback search for elements.
 * @param {Object} step
 * @returns {HTMLElement|null}
 */
function fuzzyFallbackSearch(step) {
  // --- AGGRESSIVE FUZZY FALLBACK (Manager Demo Mode) ---
  // If all specific locators fail, search for any clickable element with matching text
  const searchText = step.description || step.value || "";
  if (searchText && searchText.length > 2 && searchText.length < 50) {
    const allElements = prioritizeCurrentOverlayMatches(
      Array.from(
        document.querySelectorAll(
          "button, a, div[role='button'], input[type='submit'], span",
        ),
      ),
    );
    for (const el of allElements) {
      const elText = getVisibleText(el)
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      const searchLower = searchText.replace(/\s+/g, " ").trim().toLowerCase();
      if (
        (elText === searchLower || elText.includes(searchLower)) &&
        isElementVisible(el)
      ) {
        console.log(`Fuzzy match found: '${elText}' matches '${searchLower}'`);
        return el;
      }
    }
  }

  // --- DEEP SHADOW DOM SEARCH ---
  // If we still haven't found it, try recursively searching all shadow roots
  const selectors =
    step.selectors || (step.selector ? { css: step.selector } : null);
  if (selectors && selectors.css) {
    console.log(`Deep searching Shadows for: ${selectors.css}`);
    const shadowEl = deepQuerySelector(selectors.css);
    if (shadowEl && isElementVisible(shadowEl)) return shadowEl;
  }

  console.log(
    `Locate failed for step. Selectors:`,
    step.selectors || step.selector,
  );
  return null;
}

/**
 * Logs successful selector match.
 * @param {string} selector
 * @param {HTMLElement} element
 */
function logSelectorSuccess(selector, element) {
  const isVisible = isElementVisible(element);
  const logMsg = `Playback: Selector "${selector}" found ${element.tagName} (ID: ${element.id}, Visible: ${isVisible})`;
  chrome.storage.local.get("e2e_debug_logs").then(({ e2e_debug_logs = [] }) => {
    e2e_debug_logs.push(`[${new Date().toISOString()}] ${logMsg}`);
    chrome.storage.local.set({ e2e_debug_logs });
  });
}

/**
 * Recursively searches for an element matching the selector in all open Shadow DOMs.
 * @param {string} selector
 * @param {Node} root
 * @returns {HTMLElement|null}
 */
function deepQuerySelector(selector, root = document) {
  // Check current scope
  let el = null;
  try {
    el = root.querySelector(selector);
  } catch (e) {}

  if (el) return el;

  // Find all elements with shadow roots in this scope
  // Note: This is expensive, but necessary for "Demo Mode" resilience
  const elements = root.querySelectorAll("*");
  for (const element of elements) {
    if (element.shadowRoot) {
      const found = deepQuerySelector(selector, element.shadowRoot);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Sends a log message to the background (which forwards it to popup).
 * @param {string} text
 * @param {string} level
 */
function logExecution(text, level = "info") {
  chrome.runtime
    .sendMessage({ type: "LOG_MESSAGE", text, level })
    .catch(() => {});

  // Also log to e2e_debug_logs for runner visibility
  chrome.storage.local.get("e2e_debug_logs").then(({ e2e_debug_logs = [] }) => {
    e2e_debug_logs.push(`[${new Date().toISOString()}] Playback: ${text}`);
    chrome.storage.local.set({ e2e_debug_logs });
  });
}

let currentlyExecutingIndex = -1;

/**
 * Detects and logs nuances (differences in element state) between recording and playback.
 * @param {HTMLElement} element
 * @param {Object} step
 */
function detectNuances(element, step) {
  if (!step.nuanceMetadata) return;

  const currentState = getElementState(element);
  const nuances = compareStates(step.nuanceMetadata, currentState);

  if (nuances.length > 0) {
    const message = nuances.join(", ");
    logExecution(`Nuances Detected: ${message}`, "warning");
    chrome.runtime
      .sendMessage({
        type: "BUG_DETECTED",
        bug: {
          stepIndex: currentlyExecutingIndex,
          type: "nuance",
          message: message,
        },
      })
      .catch(() => {});
    console.log(
      `[Nuance Detection] Step ${currentlyExecutingIndex + 1}:`,
      nuances,
    );
  }
}

function isDecorativeElement(el) {
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toUpperCase();
  return ["I", "SVG", "PATH", "USE", "SPAN"].includes(tag);
}

function getClickableAncestor(el, maxDepth = 5) {
  let current = el;
  let depth = 0;
  while (current && depth < maxDepth) {
    const tag = (current.tagName || "").toUpperCase();
    const role = current.getAttribute && current.getAttribute("role");
    if (tag === "BUTTON" || tag === "A") return current;
    if (role === "button" || role === "link") return current;
    if (current.hasAttribute && current.hasAttribute("onclick")) return current;
    if (typeof current.tabIndex === "number" && current.tabIndex >= 0)
      return current;
    current = current.parentElement;
    depth++;
  }
  return null;
}

/**
 * Robustly sends STEP_COMPLETE to the background with retry.
 * Heavy DOM re-renders (drawer close, table updates) can cause
 * chrome.runtime.sendMessage to fail silently. This retries to ensure delivery.
 */
function sendStepComplete(stepIndex, maxRetries = 3) {
  let attempt = 0;
  function trySend() {
    attempt++;
    try {
      chrome.runtime.sendMessage(
        { type: "STEP_COMPLETE", stepIndex },
        (response) => {
          if (chrome.runtime.lastError) {
            const errMsg = chrome.runtime.lastError.message;
            console.warn(
              `STEP_COMPLETE attempt ${attempt} failed for step ${stepIndex + 1}: ${errMsg}`,
            );
            logExecution(
              `Step ${stepIndex + 1}: STEP_COMPLETE delivery attempt ${attempt} failed: ${errMsg}`,
              "warning",
            );
            if (attempt < maxRetries) {
              setTimeout(trySend, 500);
            } else {
              console.error(
                `STEP_COMPLETE failed after ${maxRetries} attempts for step ${stepIndex + 1}`,
              );
              logExecution(
                `Step ${stepIndex + 1}: STEP_COMPLETE failed after ${maxRetries} attempts — background may not advance`,
                "error",
              );
            }
          } else {
            logExecution(
              `Step ${stepIndex + 1}: STEP_COMPLETE delivered successfully (attempt ${attempt})`,
              "debug",
            );
          }
        },
      );
    } catch (err) {
      console.warn(
        `STEP_COMPLETE exception on attempt ${attempt} for step ${stepIndex + 1}: ${err.message}`,
      );
      if (attempt < maxRetries) {
        setTimeout(trySend, 500);
      }
    }
  }
  trySend();
}

/**
 * Executes a single command on the page.
 * @param {Object} step
 * @param {number} index
 */
async function executeSingleStep(step, index) {
  if (currentlyExecutingIndex === index) return;
  currentlyExecutingIndex = index;

  logExecution(`Step ${index + 1} starting: ${JSON.stringify(step)}`, "info");

  try {
    let element = null;
    const maxAttempts = 40; // Increased to 10 seconds total (40 * 250ms)
    const waitTime = 300;

    if (step.action !== "scroll") {
      for (let i = 0; i < maxAttempts; i++) {
        element = locateElement(step, i);
        if (element && isElementVisible(element)) break;
        element = null;

        // Phase 1 (after 1.5s): Re-click/focus combobox inputs to reopen
        // dropdowns that may have closed during script re-injection
        if (
          i === 6 &&
          step.action === "click" &&
          (isStepTargetingOption(step) || isStepTargetingDate(step))
        ) {
          const comboboxInputs = Array.from(
            document.querySelectorAll(
              'input[role="combobox"], input[placeholder*="plant" i], input[placeholder*="Select" i], input.react-datepicker-ignore-onclickoutside, .react-datepicker__input-container input',
            ),
          ).filter((el) => isElementVisible(el));

          // Phase 1 (RE-CLICK): Prioritize the last interacted element if it's a combobox or any input
          let sortedCombos = [...comboboxInputs];
          if (
            lastInteractedElement &&
            (lastInteractedElement.tagName === "INPUT" ||
              lastInteractedElement.tagName === "BUTTON") &&
            isElementVisible(lastInteractedElement)
          ) {
            sortedCombos = [
              lastInteractedElement,
              ...sortedCombos.filter((el) => el !== lastInteractedElement),
            ];
          }

          for (const cb of sortedCombos) {
            logExecution(
              `Step ${index + 1}: Re-clicking combobox "${cb.placeholder || cb.getAttribute("aria-label")}" to reopen dropdown`,
              "info",
            );
            cb.click();
            cb.focus();
            cb.dispatchEvent(new Event("focus", { bubbles: true }));
            cb.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            cb.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 1500));

            element = locateElement(step, i);
            if (element && isElementVisible(element)) break;
            element = null;
          }
          // ALSO: Check for collapsed sections if we are looking for a checkbox or similar
          // This helps if a click on a section header (Step 55) didn't expand it or it collapsed back
          const collapsedSections = Array.from(
            document.querySelectorAll(
              'button[aria-expanded="false"], .filterItemActionWrapper:not(.expanded), .accordion-summary[aria-expanded="false"]',
            ),
          ).filter(isElementVisible);

          for (const section of collapsedSections) {
            logExecution(
              `Step ${index + 1}: Attempting to expand section "${section.innerText.split("\n")[0]}" to find target`,
              "info",
            );
            section.click();
            await new Promise((r) => setTimeout(r, 1500)); // Wait for expansion

            element = locateElement(step, i);
            if (element && isElementVisible(element)) break;
            element = null;
          }
          if (element) break;
        }

        // Phase 2 (after 5s): Try typing a search term to filter dropdown results
        // ONLY for steps that are targeting dropdown options, not radios/checkboxes/etc.
        if (
          i === 20 &&
          step.action === "click" &&
          (isStepTargetingOption(step) || isStepTargetingDate(step))
        ) {
          const searchTerm = extractSearchTermFromStep(step);
          if (searchTerm) {
            logExecution(
              `Step ${index + 1}: Typing "${searchTerm}" into combobox to trigger search`,
              "info",
            );

            const searchInputs = Array.from(
              document.querySelectorAll(
                'input[role="combobox"], input[placeholder*="Search" i], input[placeholder*="item" i], input[placeholder*="plant" i], input[placeholder*="GSTIN" i], input[placeholder*="contact" i], input[placeholder*="company" i]',
              ),
            ).filter((el) => isElementVisible(el));

            // Phase 2 (SEARCH TYPE): Prioritize the last interacted element if it's an input
            let sortedSearch = [...searchInputs];
            if (
              lastInteractedElement &&
              lastInteractedElement.tagName === "INPUT" &&
              isElementVisible(lastInteractedElement)
            ) {
              sortedSearch = [
                lastInteractedElement,
                ...sortedSearch.filter((el) => el !== lastInteractedElement),
              ];
            }

            for (const searchInput of sortedSearch) {
              searchInput.click();
              searchInput.focus();
              await new Promise((r) => setTimeout(r, 200));

              const nativeSetter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                "value",
              )?.set;
              if (nativeSetter) {
                nativeSetter.call(searchInput, searchTerm);
              } else {
                searchInput.value = searchTerm;
              }
              searchInput.dispatchEvent(new Event("input", { bubbles: true }));
              searchInput.dispatchEvent(new Event("change", { bubbles: true }));
              await new Promise((r) => setTimeout(r, 2000));

              element = locateElement(step, i);
              if (element && isElementVisible(element)) break;
              element = null;
            }
            if (element) break;
          }
        }

        await new Promise((r) => setTimeout(r, waitTime));
      }

      if (!element) {
        throw new Error(
          `Element not found or not visible for step:${index + 1} (${step.action})`,
        );
      }
      logExecution(
        `Step ${index + 1}: Element found, executing ${step.action}`,
        "success",
      );

      // Perform nuance detection
      detectNuances(element, step);
    }

    if (step.action === "click") {
      const desc = (step.description || "").toLowerCase();
      const targetText = (step.target || "").toLowerCase();
      const isEditClick =
        desc.includes("edit") ||
        targetText.includes("edit") ||
        (step.selectors || []).some(
          (s) =>
            (Array.isArray(s) ? s[0] : s)
              ?.toLowerCase()
              .includes("edit"),
        );
      const overlaySnapshotBeforeClick = isEditClick
        ? snapshotVisibleOverlays()
        : null;

      const clickableParent = isDecorativeElement(element)
        ? getClickableAncestor(element)
        : null;
      if (clickableParent && clickableParent !== element) {
        element = clickableParent;
      }

      // SETTLE TIME
      await new Promise((r) => setTimeout(r, 600));

      const isCheckboxOrRadio =
        element.tagName === "INPUT" &&
        (element.type === "radio" || element.type === "checkbox");

      // REDUNDANCY CHECK: Skip if we just interacted with this checkbox/radio or its label/control
      if (isCheckboxOrRadio && lastInteractedElement) {
        const isSelf = element === lastInteractedElement;
        const isMyLabel =
          lastInteractedElement.tagName === "LABEL" &&
          lastInteractedElement.control === element;
        const isMyControl =
          element.tagName === "INPUT" &&
          lastInteractedElement === element.control; // unlikely but possible

        if (isSelf || isMyLabel || isMyControl) {
          logExecution(
            `Step ${index + 1}: Skipping redundant click on checkbox/radio (already handled via label or previous click)`,
            "info",
          );
          sendStepComplete(index);
          return;
        }
      }

      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });
      await new Promise((r) => setTimeout(r, 100));
      highlightElement(element);

      const { offsetX, offsetY } = step;
      const rect = element.getBoundingClientRect();
      const clientX =
        rect.left +
        (clickableParent ? rect.width / 2 : offsetX || rect.width / 2);
      const clientY =
        rect.top +
        (clickableParent ? rect.height / 2 : offsetY || rect.height / 2);

      const eventOptions = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX,
        clientY,
        buttons: 1,
      };

      // Dispatch full sequence including PointerEvents for modern frameworks (MUI, etc.)
      try {
        element.dispatchEvent(
          new PointerEvent("pointerdown", {
            ...eventOptions,
            pointerType: "mouse",
          }),
        );
        element.dispatchEvent(new MouseEvent("mousedown", eventOptions));
        element.dispatchEvent(
          new PointerEvent("pointerup", {
            ...eventOptions,
            pointerType: "mouse",
          }),
        );
        element.dispatchEvent(new MouseEvent("mouseup", eventOptions));

        // Use standard click for basic behavior
        element.click();
        lastInteractedElement = element;
      } catch (e) {
        console.warn("Event dispatch failed, falling back to basic click", e);
        element.click();
        lastInteractedElement = element;
      }

      console.log(
        `Executed step ${index + 1}: Click at (${clientX}, ${clientY}) on ${getElementDescriptor(element)}`,
      );
      logExecution(
        `Step ${index + 1}: Click executed on ${getElementDescriptor(element)} at (${clientX}, ${clientY})`,
        "success",
      );

      // POST-CLICK SETTLE TIME: If this button likely triggers a transition (e.g. "Send OTP", "Login"),
      // wait a bit longer to allow the UI to actually change before sendStepComplete fires.
      // For edit-button clicks, wait for MUI Dialog/Drawer to animate open before
      // the next step tries to find elements inside it.
      if (isEditClick) {
        logExecution(
          `Step ${index + 1}: Waiting 1.5s for MUI dialog/drawer to open after edit click...`,
          "info",
        );
        await new Promise((r) => setTimeout(r, 1500));
        const openedOverlay = resolveNewOverlayFromSnapshot(
          overlaySnapshotBeforeClick,
        );
        if (openedOverlay) {
          logExecution(
            `Step ${index + 1}: Locked follow-up steps to opened overlay "${getElementDescriptor(openedOverlay) || openedOverlay.className || openedOverlay.tagName}"`,
            "info",
          );
        }
      } else if (
        desc.includes("otp") ||
        desc.includes("login") ||
        desc.includes("submit") ||
        targetText.includes("otp") ||
        targetText.includes("login") ||
        desc.includes("add") ||
        desc.includes("save") ||
        desc.includes("update") ||
        desc.includes("next")
      ) {
        logExecution(
          `Step ${index + 1}: Waiting 2s for transition after transition-triggering click...`,
          "info",
        );
        await new Promise((r) => setTimeout(r, 2000));
        const activeOverlay = getTopmostActiveOverlay();
        pinnedOverlayElement =
          getPinnedOverlayContext() || activeOverlay || pinnedOverlayElement;
      }

      // Send STEP_COMPLETE immediately.
      // finding (400ms + 10s retry loop) handles framework processing time.
      // DO NOT use setTimeout here — heavy DOM teardowns (MUI Drawer unmount,
      // React portal cleanup) can kill pending setTimeout callbacks.
      sendStepComplete(index);
    } else if (step.action === "input") {
      // SETTLE TIME
      await new Promise((r) => setTimeout(r, 500));

      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });

      // If we found a LABEL, redirect to its control (the actual input)
      if (element.tagName === "LABEL" && element.control) {
        logExecution(
          `Redirecting input action from LABEL to its control: ${element.control.tagName}`,
          "info",
        );
        element = element.control;
      }

      element.focus();
      highlightElement(element);
      await new Promise((r) => setTimeout(r, 100));

      try {
        if (
          element.tagName === "INPUT" &&
          (element.type === "radio" || element.type === "checkbox")
        ) {
          if (!element.checked) {
            element.checked = true;
            lastInteractedElement = element;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            logExecution(
              `Step ${index + 1}: Checkbox already checked, skipping redundant state enforcement`,
              "info",
            );
          }
        } else {
          // React/Angular Support: Directly set value property to bypass tracking wrapper
          const prototype =
            element instanceof HTMLTextAreaElement
              ? window.HTMLTextAreaElement.prototype
              : element instanceof HTMLSelectElement
                ? window.HTMLSelectElement.prototype
                : element instanceof HTMLInputElement
                  ? window.HTMLInputElement.prototype
                  : null;

          if (prototype) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              prototype,
              "value",
            ).set;
            nativeInputValueSetter.call(element, step.value || "");
            lastInteractedElement = element;

            // Dispatch full event sequence for frameworks
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            // Fallback for custom components or labels that don't have a control
            element.value = step.value || "";
            lastInteractedElement = element;
            element.dispatchEvent(new Event("input", { bubbles: true }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }

        const { e2e_debug_logs = [] } =
          await chrome.storage.local.get("e2e_debug_logs");
        e2e_debug_logs.push(
          `[${new Date().toISOString()}] Playback: Input "${step.value}" into ${element.tagName} (ID: ${element.id}) successful`,
        );
        await chrome.storage.local.set({ e2e_debug_logs });
      } catch (e) {
        const { e2e_debug_logs = [] } =
          await chrome.storage.local.get("e2e_debug_logs");
        e2e_debug_logs.push(
          `[${new Date().toISOString()}] Playback: Input error on ${element.tagName}: ${e.message}`,
        );
        await chrome.storage.local.set({ e2e_debug_logs });
        throw e;
      }

      // Simulate key events (some frameworks listen for these)
      element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));

      console.log(`Executed step ${index + 1}: Input "${step.value}"`);
      // Send STEP_COMPLETE directly — avoid setTimeout which can be killed by DOM teardowns
      sendStepComplete(index);
    } else if (step.action === "upload") {
      // FILE UPLOAD
      await new Promise((r) => setTimeout(r, 600));

      element.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "center",
      });
      highlightElement(element);

      try {
        const fileName = step.value || "test-upload.pdf";
        const mimeType = fileName.endsWith(".pdf")
          ? "application/pdf"
          : fileName.endsWith(".png")
            ? "image/png"
            : fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")
              ? "image/jpeg"
              : "application/octet-stream";

        // Create a dummy file using DataTransfer
        const dt = new DataTransfer();
        const dummyContent = `%PDF-1.4\nTest document for automated upload\n`;
        const file = new File([dummyContent], fileName, { type: mimeType });
        dt.items.add(file);
        element.files = dt.files;

        // Dispatch change event so the app detects the file selection
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("input", { bubbles: true }));

        logExecution(
          `Step ${index + 1}: File "${fileName}" uploaded to ${element.tagName}`,
          "success",
        );
        console.log(`Executed step ${index + 1}: Upload "${fileName}"`);
      } catch (e) {
        console.error("File upload failed:", e);
        logExecution(
          `Step ${index + 1}: File upload failed: ${e.message}`,
          "error",
        );
        throw e;
      }

      // Send STEP_COMPLETE directly — avoid setTimeout which can be killed by DOM teardowns
      sendStepComplete(index);
    } else if (step.action === "scroll") {
      try {
        const pos = JSON.parse(step.value || '{"x":0,"y":0}');
        logExecution(
          `Step ${index + 1}: Scrolling to ${pos.x}, ${pos.y}...`,
          "info",
        );
        window.scrollTo({ left: pos.x, top: pos.y, behavior: "smooth" });
        console.log(`Executed step ${index + 1}: Scroll to ${pos.x}, ${pos.y}`);

        // Use a more defensive approach to ensure STEP_COMPLETE is sent
        setTimeout(() => {
          try {
            logExecution(
              `Step ${index + 1}: Scroll complete. Sending STEP_COMPLETE message...`,
              "info",
            );
            console.log(
              `[Playback] Sending STEP_COMPLETE for step ${index + 1}`,
            );
            chrome.runtime.sendMessage(
              {
                type: "STEP_COMPLETE",
                stepIndex: index,
              },
              (response) => {
                if (chrome.runtime.lastError) {
                  logExecution(
                    `Error sending STEP_COMPLETE: ${chrome.runtime.lastError.message}`,
                    "error",
                  );
                } else {
                  logExecution(`STEP_COMPLETE sent successfully.`, "debug");
                }
              },
            );
          } catch (err) {
            console.error("Failed to send STEP_COMPLETE for scroll:", err);
          }
        }, 1000);
      } catch (e) {
        console.error("Error in scroll action:", e);
        try {
          logExecution(
            `Step ${index + 1}: Scroll failed but continuing.`,
            "warning",
          );
          chrome.runtime.sendMessage({
            type: "STEP_COMPLETE",
            stepIndex: index,
          });
        } catch (err) {
          console.error(
            "Failed to send STEP_COMPLETE after scroll error:",
            err,
          );
        }
      }
    }
  } catch (err) {
    if (err.message.includes("Element not found")) {
      // In multi-frame pages, only one frame may have the element.
      // Send STEP_ERROR after a delay to give other frames a chance first.
      console.log(
        `Step ${index + 1}: Element not found in this frame (${window.location.href})`,
      );
      logExecution(
        `Step ${index + 1}: Element not found/not visible in frame ${window.location.href}`,
        "warning",
      );
      // Only send error from top frame to avoid duplicate errors from subframes
      if (window === window.top) {
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: "STEP_ERROR",
            error: `Element not found for step ${index + 1}: ${err.message}`,
            stepIndex: index,
          });
        }, 2000); // Delay to let subframes try first
      }
    } else {
      console.error(`Error executing step ${index + 1}:`, err);
      chrome.runtime
        .sendMessage({
          type: "BUG_DETECTED",
          bug: {
            stepIndex: index,
            type: "error",
            message: err.message,
          },
        })
        .catch(() => {});
      chrome.runtime.sendMessage({
        type: "STEP_ERROR",
        error: err.message,
        stepIndex: index,
      });
    }
  }
}

/**
 * Captures a simplified ARIA snapshot of the page for extension-side failure reporting.
 */
function captureAriaSnapshotContent() {
  const isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const style = window.getComputedStyle(el);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      el.offsetWidth > 0 &&
      el.offsetHeight > 0
    );
  };

  const getAriaRole = (el) => {
    return el.getAttribute("role") || el.tagName.toLowerCase() || "generic";
  };

  const getAriaName = (el) => {
    // Priority: aria-label -> aria-labelledby -> title -> alt (for images) -> inner text
    const label = el.getAttribute("aria-label");
    if (label) return label;

    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.innerText.trim();
    }

    const title = el.getAttribute("title");
    if (title) return title;

    if (el.tagName === "IMG") {
      const alt = el.getAttribute("alt");
      if (alt) return alt;
    }

    // Capture first line of text or truncated text
    return (el.innerText || "").split("\n")[0].trim().substring(0, 100);
  };

  const walk = (node, depth = 0) => {
    if (!node || node.nodeType !== 1 || !isVisible(node) || depth > 15)
      return null;

    // Skip technical elements
    const tag = node.tagName;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "META", "LINK"].includes(tag))
      return null;

    const snapshot = {
      role: getAriaRole(node),
      name: getAriaName(node),
    };

    if (node.children && node.children.length > 0) {
      const children = Array.from(node.children)
        .map((c) => walk(c, depth + 1))
        .filter(Boolean);
      if (children.length > 0) snapshot.children = children;
    }

    return snapshot;
  };

  try {
    return walk(document.body);
  } catch (err) {
    console.error("Failed to capture ARIA snapshot:", err);
    return { role: "error", name: err.message };
  }
}
