function skipComment(text, index) {
  let depth = 0, i = index;
  while (i < text.length) {
    if (text[i] === "[") depth += 1;
    if (text[i] === "]" && --depth === 0) return i + 1;
    i += 1;
  }
  return text.length;
}

function skipSpaceAndComments(text, index) {
  let i = index;
  while (i < text.length) {
    if (/\s/.test(text[i])) { i += 1; continue; }
    if (text[i] === "[") { i = skipComment(text, i); continue; }
    break;
  }
  return i;
}

function semicolonAfter(text, index) {
  let quoted = false;
  for (let i = index; i < text.length; i += 1) {
    if (text[i] === "'") { if (quoted && text[i + 1] === "'") { i += 1; continue; } quoted = !quoted; }
    else if (!quoted && text[i] === "[") i = skipComment(text, i) - 1;
    else if (!quoted && text[i] === ";") return i;
  }
  return -1;
}

function rangeAfterDelimiter(text, index) {
  const start = skipSpaceAndComments(text, index);
  if (!text[start] || "(),:;".includes(text[start])) return null;
  if (text[start] === "'") {
    let i = start + 1;
    while (i < text.length) {
      if (text[i] === "'") { if (text[i + 1] === "'") { i += 2; continue; } return { start, end: i + 1 }; }
      i += 1;
    }
    throw new Error("An unterminated quoted node label was found.");
  }
  let end = start;
  while (end < text.length && !/\s/.test(text[end]) && !"(),:;[".includes(text[end])) end += 1;
  return end > start ? { start, end } : null;
}

function translationRanges(text) {
  const match = /\btranslate\b/ig.exec(text);
  if (!match) return [];
  const end = semicolonAfter(text, match.index + match[0].length);
  if (end < 0) throw new Error("The NEXUS TRANSLATE block has no closing semicolon.");
  const ranges = [];
  let i = match.index + match[0].length;
  while (i < end) {
    i = skipSpaceAndComments(text, i);
    if (text[i] === ",") { i += 1; continue; }
    while (i < end && !/\s/.test(text[i]) && text[i] !== ",") i += 1; // translation token
    const range = rangeAfterDelimiter(text, i);
    if (!range || range.start >= end) break;
    ranges.push(range);
    i = range.end;
    while (i < end && text[i] !== ",") i += 1;
  }
  return ranges;
}

function treeRange(text) {
  const nexus = /\btree\s+[^=;]+?=/ig.exec(text);
  const startAt = nexus ? nexus.index + nexus[0].length : 0;
  const start = text.indexOf("(", startAt);
  const end = start < 0 ? -1 : semicolonAfter(text, start);
  if (start < 0 || end < 0) throw new Error("No complete Newick tree was found.");
  return { start, end };
}

function newickLabelRanges(text, includeInternal) {
  const { start, end } = treeRange(text), ranges = [];
  for (let i = start; i < end; i += 1) {
    const character = text[i];
    if (character === "[") { i = skipComment(text, i) - 1; continue; }
    if (character !== "(" && character !== "," && (!includeInternal || character !== ")")) continue;
    const range = rangeAfterDelimiter(text, i + 1);
    if (range && range.end <= end) { ranges.push(range); i = range.end - 1; }
  }
  return ranges;
}

function decodeLabel(value) { return value.startsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : value; }
function encodeLabel(value, original) {
  const needsQuotes = original.startsWith("'") || /[\s(),:;\[\]']/.test(value);
  return needsQuotes ? `'${value.replaceAll("'", "''")}'` : value;
}

export function parseRenameRules({ search = "", replacement = "", batch = "", regex = false }) {
  const source = batch.trim() ? batch.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
    const marker = line.indexOf("=>");
    if (marker < 0) throw new Error(`Batch rule ${index + 1} must use “search => replacement”.`);
    return { search: line.slice(0, marker).trim(), replacement: line.slice(marker + 2).trim() };
  }) : [{ search, replacement }];
  return source.map((rule, index) => {
    if (!rule.search) throw new Error(`Rule ${index + 1} has no search text.`);
    let matcher;
    try { matcher = regex ? new RegExp(rule.search, "g") : null; }
    catch (error) { throw new Error(`Rule ${index + 1} has an invalid regular expression: ${error.message}`); }
    return { ...rule, matcher };
  });
}

export function renameTreeLabels(text, rules, { includeInternal = false } = {}) {
  const ranges = translationRanges(text);
  const targets = ranges.length ? ranges : newickLabelRanges(text, includeInternal);
  const changes = [];
  for (const range of targets) {
    const original = text.slice(range.start, range.end);
    let value = decodeLabel(original);
    for (const rule of rules) value = rule.matcher ? value.replace(rule.matcher, rule.replacement) : value.split(rule.search).join(rule.replacement);
    if (value !== decodeLabel(original)) changes.push({ ...range, before: decodeLabel(original), after: value, replacement: encodeLabel(value, original) });
  }
  let result = text;
  for (const change of [...changes].sort((a, b) => b.start - a.start)) result = result.slice(0, change.start) + change.replacement + result.slice(change.end);
  return { text: result, changes, target: ranges.length ? "translate" : "newick" };
}

export function listTreeLabels(text, { includeInternal = false } = {}) {
  const ranges = translationRanges(text);
  const targets = ranges.length ? ranges : newickLabelRanges(text, includeInternal);
  return [...new Set(targets.map(range => decodeLabel(text.slice(range.start, range.end))))];
}
