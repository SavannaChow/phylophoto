from pathlib import Path

import pytest

from tree_utils import (
    assign_node_ids,
    bootstrap_value,
    descendant_tip_names,
    match_photo_folders,
    parse_newick,
    prefix_key,
    root_tree,
)


TREE = "((A_one:1,A_two:1):1,(B_one:1,(C_one:1,C_two:1):1):1);"


def test_parse_and_tip_labels_are_unique():
    tree = parse_newick(TREE)
    assert [tip.name for tip in tree.get_terminals()] == ["A_one", "A_two", "B_one", "C_one", "C_two"]
    with pytest.raises(ValueError, match="unique"):
        parse_newick("(A:1,A:1);")


def test_single_outgroup_root_and_missing_name():
    tree = parse_newick(TREE)
    rooted, report = root_tree(tree, "Single outgroup tip", ["A_one"])
    assert rooted.rooted
    assert report.selected_outgroups == ("A_one",)
    with pytest.raises(ValueError, match="not found"):
        root_tree(tree, "Single outgroup tip", ["missing"])


def test_non_monophyletic_mrca_report_lists_extra_descendants():
    tree = parse_newick(TREE)
    _, report = root_tree(tree, "Multiple outgroup tips (MRCA)", ["B_one", "C_one"])
    assert report.is_monophyletic is False
    assert set(report.mrca_descendants) == {"B_one", "C_one", "C_two"}


def test_descendants_use_rooted_tree():
    tree, _ = root_tree(parse_newick(TREE), "Single outgroup tip", ["A_one"])
    nodes, _ = assign_node_ids(tree)
    assert any(set(descendant_tip_names(node)) == {"A_two", "B_one", "C_one", "C_two"} for node in nodes.values())


def test_prefix_rules():
    assert prefix_key("ABC_12_sample", "Leading fields", "_", 2) == "ABC_12"
    assert prefix_key("ABC_12_sample", "Full tip label") == "ABC_12_sample"
    assert prefix_key("ABC-12_sample", "Regular expression", pattern=r"^([^-]+-[0-9]+)") == "ABC-12"


def test_bootstrap_is_read_from_newick_internal_labels():
    tree = parse_newick("((A:1,B:1)98:1,C:1);")
    internal = next(clade for clade in tree.get_nonterminals() if clade is not tree.root)
    assert bootstrap_value(internal) == "98"


def test_folder_matching_and_ambiguity(tmp_path: Path):
    (tmp_path / "A_photos").mkdir()
    (tmp_path / "B_first").mkdir()
    (tmp_path / "B_second").mkdir()
    matches = match_photo_folders(["A_one", "B_one", "C_one"], tmp_path, "Leading fields")
    assert matches["A_one"].status == "matched"
    assert matches["B_one"].status == "ambiguous"
    assert matches["C_one"].status == "missing"
