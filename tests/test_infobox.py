import json
import unittest
from pathlib import Path

from kpop_scraping.infobox import field_items, infobox_fields

AESPA = json.loads(
    (Path(__file__).parent / "fixtures" / "infobox-aespa-rev1375560471.json").read_text(encoding="utf-8")
)


def items(wikitext, field):
    return [item.names for item in field_items(wikitext, infobox_fields(wikitext)[field])]


class InfoboxFieldsTest(unittest.TestCase):
    def test_reads_named_fields_of_the_musical_artist_infobox(self):
        wikitext = (
            "{{Short description|Group}}\n"
            "{{Infobox musical artist\n"
            "| name = Twice\n"
            "| image = Twice.jpg\n"
            "| label = {{hlist|[[JYP Entertainment|JYP]]|[[Warner Music Japan]]}}\n"
            "| current_members = {{flatlist|\n* Nayeon\n* [[Momo (singer)|Momo]]\n}}\n"
            "}}\n'''Twice''' is a group."
        )
        fields = infobox_fields(wikitext)
        self.assertEqual(set(fields), {"name", "image", "label", "current_members"})
        start, end = fields["name"]
        self.assertEqual(wikitext[start:end].strip(), "Twice")

    def test_page_without_the_infobox_has_no_fields(self):
        self.assertEqual(infobox_fields("{{Infobox person\n| name = A\n}}"), {})
        self.assertEqual(infobox_fields("{{Infobox musical artist\n| name = A\n"), {})

    def test_pipes_inside_links_and_templates_do_not_split_fields(self):
        wikitext = "{{Infobox musical artist|label=[[A|B]]{{efn|x=y|z}}|origin=Seoul}}"
        fields = infobox_fields(wikitext)
        self.assertEqual(set(fields), {"label", "origin"})

    def test_field_names_ignore_case_and_spaces(self):
        wikitext = "{{Infobox Musical Artist\n| Current members = A\n}}"
        self.assertIn("current_members", infobox_fields(wikitext))


class InfoboxItemsTest(unittest.TestCase):
    def test_list_templates_and_links(self):
        wikitext = "{{Infobox musical artist\n| label = {{hlist|[[JYP Entertainment|JYP]]|[[Warner Music Japan]]}}\n}}"
        self.assertEqual(
            items(wikitext, "label"),
            [("JYP Entertainment", "JYP"), ("Warner Music Japan",)],
        )

    def test_bulleted_lists_breaks_and_commas(self):
        wikitext = (
            "{{Infobox musical artist\n"
            "| current_members = {{plainlist|\n* Keeho\n* [[Theo (singer)|Theo]]\n}}\n"
            "| past_members = Sunmi<br />[[Hyuna]], Sohee\n"
            "}}"
        )
        self.assertEqual(items(wikitext, "current_members"), [("Keeho",), ("Theo (singer)", "Theo")])
        self.assertEqual(items(wikitext, "past_members"), [("Sunmi",), ("Hyuna",), ("Sohee",)])

    def test_references_comments_and_trailing_notes_are_removed(self):
        wikitext = (
            "{{Infobox musical artist\n"
            "| label = {{flatlist|\n"
            "* Spire<!-- lists every company -->\n"
            "* IPQ<ref>{{Cite web |title=A, B |url=https://example.test}}</ref>\n"
            "* [[Pledis Entertainment|Pledis]] (2015–2020)<ref name=\"x\" />\n"
            "}}\n}}"
        )
        self.assertEqual(
            items(wikitext, "label"),
            [("Spire",), ("IPQ",), ("Pledis Entertainment", "Pledis")],
        )

    def test_item_with_extra_text_or_several_links_gives_no_name(self):
        wikitext = (
            "{{Infobox musical artist\n"
            "| label = [[EMI Records|EMI]]/[[Universal Music|Universal]]\n"
            "| past_members = Jessica, formerly of [[Girls' Generation]]\n"
            "}}"
        )
        self.assertEqual(items(wikitext, "label"), [])
        # The comma separates items; the second one mixes text and a link.
        self.assertEqual(items(wikitext, "past_members"), [("Jessica",)])

    def test_other_templates_are_dropped(self):
        wikitext = "{{Infobox musical artist\n| current_members = * {{ill|Friendshiping|ko|우정잉}}\n* Amy Park\n}}"
        self.assertEqual(items(wikitext, "current_members"), [("Amy Park",)])

    def test_item_span_points_to_the_original_wikitext(self):
        wikitext = "{{Infobox musical artist\n| label = {{hlist|[[JYP Entertainment|JYP]]|Studio J}}\n}}"
        found = field_items(wikitext, infobox_fields(wikitext)["label"])
        self.assertEqual([wikitext[i.start:i.end] for i in found], ["[[JYP Entertainment|JYP]]", "Studio J"])
        self.assertEqual([i.text for i in found], ["[[JYP Entertainment|JYP]]", "Studio J"])

    def test_link_to_another_namespace_keeps_only_its_label(self):
        wikitext = "{{Infobox musical artist\n| label = [[:ko:하이브|Hybe]]\n}}"
        self.assertEqual(items(wikitext, "label"), [("Hybe",)])


class InfoboxCommentAroundListTest(unittest.TestCase):
    def test_comment_after_a_list_template_keeps_its_items(self):
        wikitext = (
            "{{Infobox musical artist\n"
            "| label = {{hlist|[[SM Entertainment|SM]]|[[Warner Records|Warner]]}} <!-- CAA is not a label -->\n"
            "}}"
        )
        found = field_items(wikitext, infobox_fields(wikitext)["label"])
        self.assertEqual([i.names for i in found], [("SM Entertainment", "SM"), ("Warner Records", "Warner")])
        self.assertEqual(
            [wikitext[i.start:i.end] for i in found],
            ["[[SM Entertainment|SM]]", "[[Warner Records|Warner]]"],
        )

    def test_comment_before_a_list_template_keeps_its_items(self):
        wikitext = "{{Infobox musical artist\n| label = <!-- note --> {{hlist|JYP|Studio J}}\n}}"
        self.assertEqual(items(wikitext, "label"), [("JYP",), ("Studio J",)])

    def test_comment_around_a_nested_list_template_keeps_its_items(self):
        wikitext = "{{Infobox musical artist\n| label = {{hlist|{{hlist|A|B}} <!-- x -->|C}}\n}}"
        self.assertEqual(items(wikitext, "label"), [("A",), ("B",), ("C",)])

    def test_text_after_the_template_does_not_prove_the_list_items(self):
        # Only comments are ignored. Other text means the value is not just a list.
        wikitext = "{{Infobox musical artist\n| label = {{hlist|A|B}} and Ghost <!-- x -->\n}}"
        self.assertEqual(items(wikitext, "label"), [("and Ghost",)])

    def test_unclosed_comment_does_not_prove_the_list_items(self):
        wikitext = "{{Infobox musical artist\n| label = {{hlist|A|B}} <!-- no end\n}}"
        names = {name for item in items(wikitext, "label") for name in item}
        self.assertFalse({"A", "B"} & names)


class AespaRevisionFixtureTest(unittest.TestCase):
    """Infobox of Aespa in revision 1375560471, with offsets of the full page."""

    def setUp(self):
        self.text = AESPA["wikitext_excerpt"]
        self.offset = AESPA["excerpt_offset"]
        self.fields = infobox_fields(self.text)

    def absolute(self, field):
        return [
            (i.names, self.offset + i.start, self.offset + i.end, i.text)
            for i in field_items(self.text, self.fields[field])
        ]

    def test_label_lists_the_three_labels_before_the_comment(self):
        self.assertEqual(self.absolute("label"), [
            (("SM Entertainment", "SM"), 1254, 1277, "[[SM Entertainment|SM]]"),
            (("Warner Records", "Warner"), 1278, 1303, "[[Warner Records|Warner]]"),
            (("Capitol Records", "Capitol"), 1304, 1331, "[[Capitol Records|Capitol]]"),
        ])

    def test_comment_text_never_becomes_an_item(self):
        items_found = self.absolute("label")
        names = {name for item in items_found for name in item[0]}
        self.assertFalse({"Creative Artists Agency", "CAA"} & names)
        self.assertNotIn("Creative Artists Agency", " ".join(item[3] for item in items_found))

    def test_bulleted_member_list_is_unchanged(self):
        self.assertEqual(
            [item[0] for item in self.absolute("current_members")],
            [("Karina (South Korean singer)", "Karina"), ("Giselle (singer)", "Giselle"),
             ("Winter (singer)", "Winter"), ("Ningning",)],
        )


if __name__ == "__main__":
    unittest.main()
