import unittest

from kpop_scraping.infobox import field_items, infobox_fields


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


if __name__ == "__main__":
    unittest.main()
