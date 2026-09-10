const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp", "image/tiff", "image/bmp"]);
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|tiff?|bmp)$/i;

export function extractNewick(text) {
  const source = String(text || "").trim();
  if (!source) throw new Error("The tree file is empty.");
  const nexusTree = source.match(/\btree\s+[^=]+?=\s*([^;]+;)/i);
  if (nexusTree) {
    const newick = nexusTree[1].replace(/^\s*\[&[RU]\]\s*/i, "");
    const translateBlock = source.match(/\btranslate\s+([\s\S]*?);/i);
    if (!translateBlock) return newick;
    const translations = new Map();
    const entries = /(?:^|,)\s*([^\s,]+)\s+('(?:''|[^'])*'|[^,\s]+)\s*/g;
    let match;
    while ((match = entries.exec(translateBlock[1])) !== null) {
      const label = match[2].startsWith("'") ? match[2].slice(1, -1).replaceAll("''", "'") : match[2];
      translations.set(match[1], label);
    }
    const translated = parseRawNewick(newick);
    const visit = node => { if (!node.children.length && translations.has(node.name)) node.name = translations.get(node.name); node.children.forEach(visit); };
    visit(translated);
    return `${serialiseNewick(translated)};`;
  }
  const firstTree = source.match(/\([^;]+;/s);
  if (!firstTree) throw new Error("No Newick tree was found in this file.");
  return firstTree[0];
}

function skipSpaceAndComments(state) {
  while (state.index < state.text.length) {
    if (/\s/.test(state.text[state.index])) { state.index += 1; continue; }
    if (state.text[state.index] === "[") {
      const end = state.text.indexOf("]", state.index + 1);
      state.index = end < 0 ? state.text.length : end + 1;
      continue;
    }
    break;
  }
}

function parseLabel(state) {
  skipSpaceAndComments(state);
  if (state.text[state.index] === "'") {
    state.index += 1;
    let value = "";
    while (state.index < state.text.length) {
      if (state.text[state.index] === "'" && state.text[state.index + 1] === "'") { value += "'"; state.index += 2; continue; }
      if (state.text[state.index] === "'") { state.index += 1; break; }
      value += state.text[state.index++];
    }
    return value;
  }
  const start = state.index;
  while (state.index < state.text.length && !/[(),:;\[\]\s]/.test(state.text[state.index])) state.index += 1;
  return state.text.slice(start, state.index);
}

function parseNode(state) {
  skipSpaceAndComments(state);
  const node = { name: "", length: null, children: [] };
  if (state.text[state.index] === "(") {
    state.index += 1;
    while (true) {
      node.children.push(parseNode(state));
      skipSpaceAndComments(state);
      if (state.text[state.index] === ",") { state.index += 1; continue; }
      if (state.text[state.index] !== ")") throw new Error(`Unexpected tree syntax near position ${state.index + 1}.`);
      state.index += 1;
      break;
    }
    node.name = parseLabel(state);
  } else {
    node.name = parseLabel(state);
    if (!node.name) throw new Error(`A tree tip near position ${state.index + 1} has no label.`);
  }
  skipSpaceAndComments(state);
  if (state.text[state.index] === ":") {
    state.index += 1;
    skipSpaceAndComments(state);
    const start = state.index;
    while (state.index < state.text.length && !/[(),;\[\]\s]/.test(state.text[state.index])) state.index += 1;
    const value = Number(state.text.slice(start, state.index));
    node.length = Number.isFinite(value) ? value : null;
  }
  skipSpaceAndComments(state);
  return node;
}

function parseRawNewick(newick) {
  const state = { text: newick, index: 0 };
  const root = parseNode(state);
  skipSpaceAndComments(state);
  if (state.text[state.index] !== ";") throw new Error(`Expected the tree to end near position ${state.index + 1}.`);
  return root;
}

export function parseNewick(newick) {
  const root = parseRawNewick(extractNewick(newick));
  const names = collectTips(root);
  if (!names.length) throw new Error("The tree has no tips.");
  const duplicates = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];
  if (duplicates.length) throw new Error(`Tip labels must be unique: ${duplicates.join(", ")}`);
  return root;
}

export function collectTips(node) { return node.children.length ? node.children.flatMap(collectTips) : [node.name]; }
function quoteLabel(value) { return !value ? "" : /[\s(),:;\[\]']/u.test(value) ? `'${value.replaceAll("'", "''")}'` : value; }
export function serialiseNewick(node) {
  const subtree = node.children.length ? `(${node.children.map(serialiseNewick).join(",")})${quoteLabel(node.name)}` : quoteLabel(node.name);
  return `${subtree}${node.length == null ? "" : `:${Number(node.length)}`}`;
}
function cloneTree(node) { return { name: node.name, length: node.length, children: node.children.map(cloneTree) }; }
function setHeights(node) { node.height = node.children.length ? collectTips(node).length - 1 : 0; node.children.forEach(setHeights); }

export function transformBranchLengths(root, mode) {
  if (mode === "original") return null;
  const copy = cloneTree(root);
  if (mode === "equal") {
    copy.length = 0;
    const visit = node => node.children.forEach(child => { child.length = 1; visit(child); });
    visit(copy);
  } else if (mode === "proportional") {
    setHeights(copy); copy.length = 0;
    const visit = node => node.children.forEach(child => { child.length = node.height - child.height; visit(child); });
    visit(copy);
  } else throw new Error(`Unknown branch display mode: ${mode}`);
  const clean = node => { delete node.height; node.children.forEach(clean); };
  clean(copy);
  return `${serialiseNewick(copy)};`;
}

export function mrcaDescendants(root, selectedNames) {
  const selected = new Set(selectedNames);
  if (!selected.size) return [];
  let answer = null;
  function visit(node) {
    const descendants = node.children.length ? node.children.flatMap(visit) : [node.name];
    if (!answer && [...selected].every(name => descendants.includes(name))) answer = descendants;
    return descendants;
  }
  visit(root);
  return answer || [];
}

export function relativePathWithinRoot(file) {
  const parts = (file.webkitRelativePath || file.name).split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join("/") : file.name;
}

export function buildFolderIndex(files) {
  const folders = new Map();
  for (const file of files) {
    const parts = relativePathWithinRoot(file).split("/");
    if (parts.length < 2 || !parts[0]) continue;
    if (!folders.has(parts[0])) folders.set(parts[0], []);
    if (IMAGE_TYPES.has(file.type) || IMAGE_EXTENSIONS.test(file.name)) folders.get(parts[0]).push(file);
  }
  return folders;
}

export function deriveKey(tip, options) {
  if (options.rule === "full") return tip;
  if (options.rule === "prefix") {
    if (!options.delimiter) throw new Error("The delimiter cannot be empty.");
    return tip.split(options.delimiter).slice(0, Math.max(1, options.fieldCount || 1)).join(options.delimiter);
  }
  if (options.rule === "regex") {
    const match = tip.match(new RegExp(options.pattern));
    return match ? (match[1] ?? match[0]) : "";
  }
  throw new Error(`Unknown folder matching rule: ${options.rule}`);
}

export function matchFolders(tips, folderIndex, options) {
  const normalise = value => options.caseSensitive ? value : value.toLocaleLowerCase();
  return tips.map(tip => {
    const key = deriveKey(tip, options), comparison = normalise(key);
    const candidates = key ? [...folderIndex.keys()].filter(folder => options.comparison === "starts" ? normalise(folder).startsWith(comparison) : normalise(folder) === comparison) : [];
    return { tip, key, candidates, folder: candidates.length === 1 ? candidates[0] : null, status: candidates.length === 1 ? "matched" : candidates.length ? "ambiguous" : "missing" };
  });
}

export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  const source = String(text || "").replace(/^\uFEFF/, "");
  for (let index = 0; index <= source.length; index += 1) {
    const char = source[index] ?? "\n";
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n") { row.push(field.replace(/\r$/, "")); if (row.some(value => value !== "")) rows.push(row); row = []; field = ""; }
    else field += char;
  }
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0];
  return { headers, rows: rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))) };
}
