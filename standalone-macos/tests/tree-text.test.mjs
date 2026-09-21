import { expect, test } from "bun:test";
import { listTreeLabels, parseRenameRules, renameTreeLabels } from "../Sources/PhyloPhotoStandalone/Resources/Web/tree-text.js";

test("renames only leaf labels while preserving Newick branch lengths and annotations", () => {
  const source = "(A:0.1[&colour=red],B:0.2)95:0.3;";
  const result = renameTreeLabels(source, parseRenameRules({ search: "A", replacement: "Sample A" }));
  expect(result.text).toBe("('Sample A':0.1[&colour=red],B:0.2)95:0.3;");
  expect(result.changes).toHaveLength(1);
});

test("uses NEXUS TRANSLATE labels instead of changing numeric tree tokens", () => {
  const source = "#NEXUS\nBegin trees;\nTranslate 1 'A one', 2 B_two;\nTree t = [&R] (1:1.2,2:3.4);\nEnd;";
  const result = renameTreeLabels(source, parseRenameRules({ search: "_", replacement: "-" }));
  expect(result.text).toContain("2 B-two;");
  expect(result.text).toContain("(1:1.2,2:3.4)");
});

test("supports batch regex rules without serialising the tree", () => {
  const source = "(AB_01:1,AB_02:2);";
  const rules = parseRenameRules({ batch: "^AB_ => X_\n_0 => _", regex: true });
  expect(renameTreeLabels(source, rules).text).toBe("(X_1:1,X_2:2);");
});

test("lists each matching leaf label once before a rename is previewed", () => {
  const labels = listTreeLabels("(S1:1,S11:2,(S110:3,S1:4)inner:5);", { includeInternal: false });
  expect(labels.filter(label => label.includes("S1"))).toEqual(["S1", "S11", "S110"]);
});
