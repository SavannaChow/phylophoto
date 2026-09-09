from pathlib import Path

import pytest

from tree_utils import (
    assign_node_ids,
    bootstrap_value,
    descendant_tip_names,
    equalise_branch_lengths,
    folder_is_effectively_empty,
    initialise_photo_library,
    load_photo_preferences,
    match_photo_folders,
    parse_newick,
    parse_tree_text,
    prefix_key,
    photo_files,
    photo_folder_labels,
    proportionalise_branch_lengths,
    root_tree,
    save_photo_preferences,
    tip_labels,
    tree_to_newick,
)


TREE = "((A_one:1,A_two:1):1,(B_one:1,(C_one:1,C_two:1):1):1);"


def test_parse_and_tip_labels_are_unique():
    tree = parse_newick(TREE)
    assert [tip.name for tip in tree.get_terminals()] == ["A_one", "A_two", "B_one", "C_one", "C_two"]
    with pytest.raises(ValueError, match="unique"):
        parse_newick("(A:1,A:1);")


def test_newick_round_trip_for_peartree():
    reparsed = parse_newick(tree_to_newick(parse_newick("((A:1,B:2)98:3,C:4);")))
    assert [tip.name for tip in reparsed.get_terminals()] == ["A", "B", "C"]
    internal = next(clade for clade in reparsed.get_nonterminals() if clade is not reparsed.root)
    assert bootstrap_value(internal) == "98"


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


def test_empty_photo_library_creation_copies_tree_and_full_tip_names(tmp_path: Path):
    (tmp_path / ".DS_Store").write_bytes(b"")
    assert folder_is_effectively_empty(tmp_path)
    labels = photo_folder_labels(["S1_Acropora_sp2", "GCA_123", "Tan44_Acropora_typeD"])
    count, tree_copy = initialise_photo_library(tmp_path, labels, "new.tree", b"(S1,GCA_123,Tan44);")
    assert count == 3
    assert tree_copy.read_bytes() == b"(S1,GCA_123,Tan44);"
    assert (tmp_path / "S1_Acropora_sp2").is_dir()
    assert (tmp_path / "GCA_123").is_dir()
    assert (tmp_path / "Tan44_Acropora_typeD").is_dir()


def test_photo_library_creation_rejects_nonempty_or_unsafe_targets(tmp_path: Path):
    (tmp_path / "existing").mkdir()
    with pytest.raises(ValueError, match="not empty"):
        initialise_photo_library(tmp_path, ["S1_safe"], "tree.nwk", b"(S1);")
    with pytest.raises(ValueError, match="safely"):
        photo_folder_labels(["S1/unsafe"], pattern="")


def test_photo_preferences_round_trip_in_library_folder(tmp_path: Path):
    preferences = {
        "folder_matching": {"rule": "Full tip label", "case_sensitive": False},
        "peartree": {"tipLabelFontSize": 13, "branchLabelAnnotation": "bootstrap"},
    }
    saved_path = save_photo_preferences(tmp_path, preferences)
    assert saved_path.parent == tmp_path
    assert load_photo_preferences(tmp_path) == preferences
    assert folder_is_effectively_empty(tmp_path)


def test_photo_files_still_finds_supported_images_recursively(tmp_path: Path):
    nested = tmp_path / "nested"
    nested.mkdir()
    image = nested / "sample.JPG"
    image.write_bytes(b"test image bytes")
    (nested / "notes.txt").write_text("not a photo", encoding="utf-8")

    assert photo_files(tmp_path) == [image]


def test_equal_and_proportional_branch_views_do_not_change_topology():
    tree = parse_newick("((A:0.1,B:0.2):0.3,(C:0.4,(D:0.5,E:0.6):0.7):0.8);")
    equal = equalise_branch_lengths(tree)
    proportional = proportionalise_branch_lengths(tree)

    assert tip_labels(equal) == tip_labels(tree)
    assert {clade.branch_length for clade in equal.find_clades() if clade is not equal.root} == {1.0}
    assert tip_labels(proportional) == tip_labels(tree)
    assert len({proportional.distance(tip) for tip in proportional.get_terminals()}) == 1
    assert tree_to_newick(tree) != tree_to_newick(equal)
