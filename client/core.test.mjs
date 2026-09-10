import { describe, expect, test } from "bun:test";
import { buildFolderIndex, collectTips, extractNewick, matchFolders, mrcaDescendants, parseCsv, parseNewick, transformBranchLengths } from "./core.js";

const tree = "((A:0.1,B:0.2)95:0.3,C:0.4);";

describe("tree handling", () => {
  test("extracts and parses named tips", () => expect(collectTips(parseNewick(extractNewick(tree)))).toEqual(["A","B","C"]));
  test("supports equal and proportional display trees", () => { const root = parseNewick(tree); expect(transformBranchLengths(root,"equal")).toContain("A:1"); expect(transformBranchLengths(root,"proportional")).toContain("95"); });
  test("reports MRCA descendants", () => expect(mrcaDescendants(parseNewick(tree),["A","B"])).toEqual(["A","B"]));
  test("resolves a NEXUS translate block", () => {
    const nexus = "#NEXUS\nBegin trees;\nTranslate 1 'Sample A', 2 Sample_B;\nTree t = [&R] (1:1,2:1);\nEnd;";
    expect(collectTips(parseNewick(extractNewick(nexus)))).toEqual(["Sample A","Sample_B"]);
  });
});

describe("browser-local files", () => {
  const files = [
    { name:"one.jpg",type:"image/jpeg",webkitRelativePath:"photos/A/one.jpg" },
    { name:"notes.txt",type:"text/plain",webkitRelativePath:"photos/A/notes.txt" },
    { name:"two.png",type:"image/png",webkitRelativePath:"photos/B/nested/two.png" },
  ];
  test("indexes direct child photo folders", () => { const index = buildFolderIndex(files); expect([...index.keys()]).toEqual(["A","B"]); expect(index.get("A")).toHaveLength(1); });
  test("matches full tip labels", () => { const result = matchFolders(["A","C"],buildFolderIndex(files),{ rule:"full",comparison:"equals",caseSensitive:false }); expect(result.map(item => item.status)).toEqual(["matched","missing"]); });
  test("parses quoted CSV fields", () => expect(parseCsv('tip,note\nA,"x,y"\n').rows[0]).toEqual({ tip:"A",note:"x,y" }));
});
