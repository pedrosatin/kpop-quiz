import copy
import json
import unittest
from pathlib import Path

from kpop_scraping.entities import GREGORIAN_CALENDAR, TimeValue, parse_statements
from kpop_scraping.evidence import (
    WikipediaPage,
    assess_references,
    formation_date_evidence,
    genre_evidence,
    membership_evidence,
    place_evidence,
    record_label_evidence,
    text_evidence,
)
from kpop_scraping.facts import group_fact_candidates, person_fact_candidates
from kpop_scraping.sources import (
    RELIABLE,
    RELIABLE_SOURCES,
    UNRELIABLE,
    UNREVIEWED,
    classify_source,
    registrable_domain,
)
from kpop_scraping.validation import ValidationContext, validate_facts

from .wikidata_fixture import (
    NAYEON,
    RED_VELVET,
    SUNMI,
    SUNYE,
    TWICE,
    WENDY,
    WONDER_GIRLS,
    YERI,
    load_fixture,
    statement,
)


EDITORIAL_FIXTURE = Path(__file__).parent / "fixtures" / "wikipedia_evidence_cases.json"
SOURCE_COVERAGE_FIXTURE = Path(__file__).parent / "fixtures" / "reference_source_coverage.json"


def page(extract, source_revision_id=1, title=""):
    return WikipediaPage(source_revision_id, "en", 10, 20, extract, title)


def decisions_by_predicate(decisions):
    result = {}
    for decision in decisions:
        result.setdefault(decision.candidate.predicate, []).append(decision)
    return result


class ValidationTest(unittest.TestCase):
    def setUp(self):
        self.fixture = load_fixture()
        self.subjects = self.fixture["subject_profile"]
        self.pages = {
            item["wikidata_id"]: page(item["extract"], index + 1)
            for index, item in enumerate(self.fixture["wikipedia_pages"])
        }

    def context(self, **names):
        entity_types = {
            TWICE: "group",
            RED_VELVET: "group",
            WONDER_GIRLS: "group",
            NAYEON: "person",
            WENDY: "person",
            YERI: "person",
            SUNYE: "person",
            SUNMI: "person",
        }
        for qid in self.fixture["label_profile"]:
            entity_types.setdefault(qid, "place")
        return ValidationContext(
            names={key: tuple(value) for key, value in names.items()},
            entity_types=entity_types,
            group_pages=self.pages,
        )

    def test_preferred_rank_supersedes_normal_values(self):
        extracted = group_fact_candidates(RED_VELVET, self.subjects[RED_VELVET])
        genres = decisions_by_predicate(
            validate_facts(extracted.candidates, self.context())
        )["genre"]
        self.assertEqual(
            [(d.candidate.statement.rank, d.status, d.reason) for d in genres],
            [
                ("preferred", "rejected", "unreliable_reference_source"),
                ("normal", "superseded", "preferred_rank_exists"),
            ],
        )
        self.assertEqual(genres[0].evidence, ())

    def test_deprecated_statement_is_ignored(self):
        entity = copy.deepcopy(self.subjects[RED_VELVET])
        statement(entity, "P495")["rank"] = "deprecated"
        extracted = group_fact_candidates(RED_VELVET, entity)
        self.assertNotIn("origin_country", {c.predicate for c in extracted.candidates})
        self.assertEqual(extracted.ignored, 1)

    def test_divergent_values_with_same_rank_are_conflicts(self):
        entity = copy.deepcopy(self.subjects[NAYEON])
        second = copy.deepcopy(statement(entity, "P569"))
        second["id"] = f"{NAYEON}$conflicting-birth-date"
        second["mainsnak"]["datavalue"]["value"]["time"] = "+1995-09-21T00:00:00Z"
        entity["claims"]["P569"].append(second)
        extracted = person_fact_candidates(NAYEON, entity, {TWICE})
        born = decisions_by_predicate(validate_facts(extracted.candidates, self.context()))["born_on"]
        self.assertEqual(
            [(d.status, d.reason) for d in born],
            [("conflict", "same_rank_values_differ")] * 2,
        )
        self.assertTrue(all(d.evidence for d in born))

    def test_less_precise_compatible_date_is_not_a_conflict(self):
        entity = copy.deepcopy(self.subjects[NAYEON])
        year_only = copy.deepcopy(statement(entity, "P569"))
        year_only["id"] = f"{NAYEON}$year-only-birth-date"
        year_only["mainsnak"]["datavalue"]["value"].update(
            {"time": "+1995-00-00T00:00:00Z", "precision": 9}
        )
        entity["claims"]["P569"].append(year_only)
        extracted = person_fact_candidates(NAYEON, entity, {TWICE})
        born = decisions_by_predicate(validate_facts(extracted.candidates, self.context()))["born_on"]
        self.assertEqual([d.status for d in born], ["accepted", "superseded"])
        self.assertIn("insufficient_precision_for_age", born[1].flags)
        self.assertNotIn("insufficient_precision_for_age", born[0].flags)

    def test_fact_without_sufficient_reference_or_page_is_rejected(self):
        # Yeri's birth date only cites P143 and person pages are not collected.
        extracted = person_fact_candidates(YERI, self.subjects[YERI], {RED_VELVET})
        born = decisions_by_predicate(validate_facts(extracted.candidates, self.context()))["born_on"]
        self.assertEqual((born[0].status, born[0].reason), ("rejected", "missing_evidence"))
        self.assertEqual(born[0].evidence, ())

    def test_year_precision_formation_without_formation_sentence_is_rejected(self):
        extracted = group_fact_candidates(WONDER_GIRLS, self.subjects[WONDER_GIRLS])
        formed = decisions_by_predicate(validate_facts(extracted.candidates, self.context()))["formed_on"]
        self.assertEqual(formed[0].candidate.time.value, "2007")
        self.assertEqual((formed[0].status, formed[0].reason), ("rejected", "missing_evidence"))
        self.assertIn("precision_below_day", formed[0].flags)

    def test_multiple_start_qualifiers_are_rejected(self):
        extracted = group_fact_candidates(WONDER_GIRLS, self.subjects[WONDER_GIRLS])
        members = decisions_by_predicate(
            validate_facts(extracted.candidates, self.context(**{SUNYE: ["Sunye"]}))
        )["has_member"]
        by_member = {d.candidate.value_id: d for d in members}
        self.assertEqual(by_member[SUNMI].reason, "ambiguous_temporal_qualifiers")
        self.assertEqual(by_member[SUNYE].status, "conflict")
        self.assertEqual(by_member[SUNYE].reason, "membership_counterpart_unverified")
        self.assertIn("validity_not_evidenced", by_member[SUNYE].flags)
        self.assertIn("extract[", by_member[SUNYE].evidence[0].locator)

    def test_membership_periods_from_both_sides_must_agree(self):
        group = copy.deepcopy(self.subjects[RED_VELVET])
        yeri_member = statement(group, "P527", 1)
        yeri_member["qualifiers"]["P580"][0]["datavalue"]["value"]["time"] = "+2016-03-17T00:00:00Z"
        candidates = (
            group_fact_candidates(RED_VELVET, group).candidates
            + person_fact_candidates(YERI, self.subjects[YERI], {RED_VELVET}).candidates
        )
        decisions = validate_facts(candidates, self.context(**{YERI: ["Yeri"]}))
        membership = [
            (d.candidate.predicate, d.status, d.reason)
            for d in decisions
            if d.candidate.predicate in {"has_member", "member_of"}
            and YERI in {d.candidate.subject_id, d.candidate.value_id}
        ]
        self.assertEqual(
            membership,
            [
                ("has_member", "conflict", "membership_period_mismatch"),
                ("member_of", "conflict", "membership_period_mismatch"),
            ],
        )

    def test_asymmetric_membership_period_is_not_eligible(self):
        group = copy.deepcopy(self.subjects[RED_VELVET])
        person = copy.deepcopy(self.subjects[YERI])
        del statement(person, "P463")["qualifiers"]["P580"]
        candidates = (
            group_fact_candidates(RED_VELVET, group).candidates
            + person_fact_candidates(YERI, person, {RED_VELVET}).candidates
        )
        decisions = validate_facts(candidates, self.context(**{YERI: ["Yeri"]}))
        membership = [
            (d.candidate.predicate, d.status, d.reason)
            for d in decisions
            if d.candidate.predicate in {"has_member", "member_of"}
            and YERI in {d.candidate.subject_id, d.candidate.value_id}
        ]
        self.assertEqual(
            membership,
            [
                ("has_member", "conflict", "membership_period_unconfirmed"),
                ("member_of", "conflict", "membership_period_unconfirmed"),
            ],
        )

    def test_membership_without_counterpart_is_not_eligible(self):
        extracted = person_fact_candidates(YERI, self.subjects[YERI], {RED_VELVET})
        decisions = validate_facts(extracted.candidates, self.context(**{YERI: ["Yeri"]}))
        membership = decisions_by_predicate(decisions)["member_of"]
        self.assertEqual(
            [(d.status, d.reason) for d in membership],
            [("rejected", "missing_evidence")],
        )

    def test_member_of_link_outside_catalog_is_ignored(self):
        extracted = person_fact_candidates(WENDY, self.subjects[WENDY], {RED_VELVET})
        values = [c.value_id for c in extracted.candidates if c.predicate == "member_of"]
        self.assertEqual(values, [RED_VELVET])
        self.assertEqual(extracted.ignored, 1)


class WikipediaEvidenceTest(unittest.TestCase):
    def test_name_match_respects_hyphenated_words(self):
        text = page("Twice is a group with genres including K-pop and dance-pop.")
        self.assertIsNone(genre_evidence(text, ["pop"], ["Twice"]))
        evidence = genre_evidence(text, ["K-pop"], ["Twice"])
        start = text.extract.index("K-pop")
        self.assertTrue(evidence.locator.endswith(f"#extract[{start}:{start + 5}]"))
        self.assertEqual(evidence.snippet, text.extract)

    def test_genre_inside_a_title_is_not_evidence(self):
        text = page("Almeng is a South Korean singing duo known for appearing on K-pop Star Season 3.")
        self.assertIsNone(genre_evidence(text, ["K-pop"], ["Almeng"]))

    def test_place_requires_formation_sentence(self):
        busking = page(
            "A.C.E is a South Korean boy band formed by Beat Interactive. "
            "The group gained a following busking in Seoul."
        )
        self.assertIsNone(place_evidence(busking, ["Seoul"], ["A.C.E"], False))
        formed = page("A.cian is a South Korean boy band formed by Wings Entertainment in Seoul.")
        evidence = place_evidence(formed, ["Seoul"], ["A.cian"], False)
        self.assertEqual(evidence.snippet, formed.extract)

    def test_member_name_must_be_capitalized_and_near_membership_words(self):
        text = page("A sunny day. The group consists of Sunny and Yuri.")
        evidence = membership_evidence(text, ["Sunny"], ["The group"])
        self.assertTrue(evidence.locator.endswith("#extract[35:40]"))
        listed = page("It was formed in 1996 with four members. They were Teddy and Danny.")
        self.assertIsNone(membership_evidence(listed, ["Teddy"], ["It"]))
        award = page("Sunny won an award.")
        self.assertIsNone(membership_evidence(award, ["Sunny"], ["Sunny"]))

    def test_formation_date_ignores_debut_sentence(self):
        value = TimeValue("2015-10-20", 11, GREGORIAN_CALENDAR)
        debut = page("Twice was formed under Sixteen and debuted on October 20, 2015.")
        self.assertIsNone(formation_date_evidence(debut, value, ["Twice"]))
        formed = page("The group was formed on October 20, 2015. It debuted later.")
        self.assertIsNotNone(formation_date_evidence(formed, value, ["The group"]))

    def test_formation_fact_belongs_to_group_clause(self):
        value_2015 = TimeValue("2015", 9, GREGORIAN_CALENDAR)
        value_2012 = TimeValue("2012", 9, GREGORIAN_CALENDAR)
        value_2016 = TimeValue("2016", 9, GREGORIAN_CALENDAR)
        charity = page("Twice member Mina created a charity in 2015 in Seoul.")
        self.assertIsNone(formation_date_evidence(charity, value_2015, ["Twice"]))
        self.assertIsNone(place_evidence(charity, ["Seoul"], ["Twice"], False))

        history = page("100% was formed by TOP Media in 2012 and disbanded in 2016.")
        self.assertIsNotNone(formation_date_evidence(history, value_2012, ["100%"]))
        self.assertIsNone(formation_date_evidence(history, value_2016, ["100%"]))

    def test_country_evidence_uses_reviewed_names_and_demonyms(self):
        historical_place = page("Twice was formed in Silla.")
        aliases = ["South Korea", "Republic of Korea", "Silla"]
        self.assertIsNone(place_evidence(historical_place, aliases, ["Twice"], True))

        demonym = page("Twice is a South Korean girl group.")
        self.assertIsNotNone(place_evidence(demonym, aliases, ["Twice"], True))

    def test_membership_change_requires_an_unambiguous_group(self):
        self.assertIsNone(
            membership_evidence(
                page("A documentary about Twice said Jennie joined the group."),
                ["Jennie"],
                ["Twice"],
            )
        )
        self.assertIsNone(
            membership_evidence(
                page("Twice performed with another act before Jennie joined the group."),
                ["Jennie"],
                ["Twice"],
            )
        )
        direct = page("In 2016, Jennie joined Blackpink.")
        self.assertIsNotNone(membership_evidence(direct, ["Jennie"], ["Blackpink"]))
        named_member = page("Blackpink member Jennie left the group in 2025.")
        self.assertIsNotNone(
            membership_evidence(named_member, ["Jennie"], ["Blackpink"])
        )

    def test_member_list_accepts_short_stage_names(self):
        listed = page("2NE1 is a group. The group consists of Bom, Dara, CL, and Minzy.")
        for stage_name, full_name in (("Bom", "Park Bom"), ("CL", "Lee Chae-lin")):
            self.assertIsNotNone(
                membership_evidence(listed, [full_name, stage_name], ["2NE1"]),
                stage_name,
            )

    def test_short_name_outside_a_member_list_is_not_evidence(self):
        prose = page("2NE1 is a group. CL released a solo album that year.")
        self.assertIsNone(membership_evidence(prose, ["Lee Chae-lin", "CL"], ["2NE1"]))

    def test_formed_by_does_not_prove_record_label(self):
        formed = page("Twice was formed by JYP Entertainment in 2015.")
        self.assertIsNone(
            record_label_evidence(formed, ["JYP Entertainment"], ["Twice"])
        )
        signed = page("Twice signed with Warner Music Japan in 2017.")
        self.assertIsNotNone(
            record_label_evidence(signed, ["Warner Music Japan"], ["Twice"])
        )

    def test_adversarial_relation_contexts_are_rejected(self):
        date = TimeValue("2015", 9, GREGORIAN_CALENDAR)
        self.assertIsNone(
            formation_date_evidence(
                page("Twice disbanded in 2015 after its agency was founded in 2010."),
                date,
                ["Twice"],
            )
        )
        self.assertIsNone(
            formation_date_evidence(
                page("Twice's agency was founded in 2015."), date, ["Twice"]
            )
        )
        self.assertIsNone(
            record_label_evidence(
                page("Twice member Mina was a trainee under JYP Entertainment."),
                ["JYP Entertainment"],
                ["Twice"],
            )
        )
        self.assertIsNone(
            place_evidence(
                page("Twice is headquartered in Seoul and toured North Korea."),
                ["Seoul", "North Korea"],
                ["Twice"],
                False,
            )
        )
        self.assertIsNone(
            membership_evidence(
                page("Twice collaborated with Sunmi. Nayeon appeared on the next song."),
                ["Sunmi", "Nayeon"],
                ["Twice"],
            )
        )
        self.assertIsNone(
            genre_evidence(
                page("Twice was compared with rock groups and challenged K-pop stereotypes."),
                ["rock", "K-pop"],
                ["Twice"],
            )
        )

    def test_dependent_clause_cannot_supply_fact_value(self):
        date = TimeValue("2015", 9, GREGORIAN_CALENDAR)
        self.assertIsNone(
            formation_date_evidence(
                page("Twice was formed by a producer who moved to Seoul in 2015."),
                date,
                ["Twice"],
            )
        )
        self.assertIsNone(
            place_evidence(
                page("Twice was formed by a producer who lived in Seoul."),
                ["Seoul"],
                ["Twice"],
                False,
            )
        )
        self.assertIsNone(
            place_evidence(
                page(
                    "Twice appeared in a documentary that was a South Korean "
                    "girl group story."
                ),
                ["South Korea"],
                ["Twice"],
                True,
            )
        )
        self.assertIsNone(
            genre_evidence(
                page("Twice appeared in a documentary that was a rock group story."),
                ["rock"],
                ["Twice"],
            )
        )
        self.assertIsNone(
            genre_evidence(
                page("Twice appeared in a documentary that discussed genres including rock."),
                ["rock"],
                ["Twice"],
            )
        )
        self.assertIsNone(
            record_label_evidence(
                page("Twice appeared in a documentary that signed with JYP Entertainment."),
                ["JYP Entertainment"],
                ["Twice"],
            )
        )
        self.assertIsNone(
            membership_evidence(
                page("Twice manager Mina joined the group."),
                ["Mina"],
                ["Twice"],
            )
        )
        self.assertIsNone(
            membership_evidence(
                page("Twice staff consists of Mina and Dahyun."),
                ["Mina"],
                ["Twice"],
            )
        )
        self.assertIsNone(
            record_label_evidence(
                page("Twice producer Mina signed with JYP Entertainment."),
                ["JYP Entertainment"],
                ["Twice"],
            )
        )

    def test_editorial_fixture_has_no_false_positive(self):
        self.maxDiff = None
        fixture = json.loads(EDITORIAL_FIXTURE.read_text(encoding="utf-8"))
        pages = fixture["pages"]
        self.assertEqual(len(fixture["cases"]), 273)
        label_counts = {
            label: sum(case["label"] == label for case in fixture["cases"])
            for label in {"proves", "does_not_prove"}
        }
        self.assertEqual(
            label_counts,
            {"proves": 135, "does_not_prove": 138},
        )
        false_positives = []
        false_negatives = []
        for case in fixture["cases"]:
            source = pages[case["group"]]
            evidence_page = WikipediaPage(
                source_revision_id=1,
                language="en",
                page_id=source["pageid"],
                revision_id=source["revid"],
                extract=source["extract"],
                title=source["title"],
            )
            raw_time = case["time"]
            value_time = (
                TimeValue(raw_time["value"], raw_time["precision"], GREGORIAN_CALENDAR)
                if raw_time
                else None
            )
            found = text_evidence(
                case["predicate"],
                evidence_page,
                case["subject_names"],
                case["value_names"],
                value_time,
            )
            if found and case["label"] == "does_not_prove":
                false_positives.append(case["id"])
            if not found and case["label"] == "proves":
                false_negatives.append(case["id"])
        self.assertEqual(false_positives, [])
        self.assertEqual(
            false_negatives,
            [
                "Q485884$0bbe1d14-4649-5348-7f48-5308fa1f84d5",
                "Q485884$6b166e50-4dc5-ad27-d30c-1af4424efd82",
                "Q171885$7B17891F-D1F7-43C8-94FA-1D66D1C466F7",
                "Q389067$51885389-4c4d-7a1e-4084-39443bd244b7",
                "Q389067$25f0ff83-4d0a-3ac1-8fa1-7e780b27440d",
                "Q389067$d805866e-4cde-f46f-6e99-9170a059c051",
                "Q389067$359a2040-4e0b-252a-3dc7-73486ca87487",
                "Q389067$933c3994-4436-5233-565b-bf9275e03a2a",
                "Q389067$6c21b6dd-470a-5503-8a73-c9a835f348a9",
                "Q389067$f9ac8b3a-48ec-9c2e-0637-67ffad1250f6",
                "Q389067$cb714b87-4dc8-828a-7697-8f321c3fd2af",
                "Q5299644$5451f09c-423e-9ea5-9a40-60f763ef1a54",
                "Q492271$b9f70c2a-431e-616c-2ee1-a9f101c50812",
                "Q10846022$4c4591ed-4401-bbfd-5864-15504b8fae34",
                "Q10846022$D57FA2DC-34FE-4B84-AA42-AB37C3FBD3A4",
                "Q10728972$a28c762d-4169-3632-8954-ed314e8f6236",
                "Q16935427$F5549980-5AC1-49FC-83A5-90F28E08EDF9",
                "Q30599348$A6ADE58B-C6B0-49D4-9C21-5D9C1A1F9105",
                "Q18697707$01679e02-4905-a93b-ef21-039d8b54c07f",
                "Q486196$6db461e6-4737-a199-58b3-5f1e59a8653b",
                "Q488725$03103157-4213-fc6d-0131-33de60ec492b",
                "Q489006$1382df34-4574-2531-6c49-a4f06a94d11a",
                "Q491515$aeb097f0-4a53-3323-a7d2-4183a1d62b16",
                "Q492691$62b26e91-49c1-3bc5-966e-faa9da81282a",
                "Q492767$9c3a9c16-4832-fa4b-200e-ff910c01d89a",
                "Q596923$b1c364f5-4fe3-964c-cab3-efe354d2321d",
                "Q7302004$c19f17a0-42c1-83ef-e8f3-a89ffa9c91ba",
                "Q7674722$bf0d740a-4bae-f692-1b73-8ab7e2c3e3e6",
                "Q7694067$30A35569-8C62-40EE-8EE7-7B35A707A4DD",
                "Q9205048$DE0B08D2-6961-4C58-B690-67B61262F24E",
            ],
        )


class SourcePolicyTest(unittest.TestCase):
    def test_real_sample_coverage_matches_versioned_policy(self):
        fixture = json.loads(SOURCE_COVERAGE_FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(fixture["sample"]["groups_processed"], 30)
        self.assertEqual(
            {
                item["source_key"]: classify_source(item["source_key"])
                for item in fixture["sources"]
            },
            {item["source_key"]: item["status"] for item in fixture["sources"]},
        )

    def test_known_unreliable_sources_are_rejected(self):
        keys = {
            "wikidata:Q3561957",
            "wikidata:Q37312",
            "wikidata:Q504063",
            "wikidata:Q14005",
            "domain:discogs.com",
            "domain:musicbrainz.org",
            "domain:famousbirthdays.com",
            "domain:pantheon.world",
            "domain:kprofiles.com",
            "domain:kpopsingers.com",
            "domain:wikipedia.org",
            "domain:wikidata.org",
            "domain:wikimedia.org",
        }
        self.assertEqual({classify_source(key) for key in keys}, {UNRELIABLE})

    def test_reviewed_official_and_editorial_sources_are_accepted(self):
        keys = {
            "domain:jype.com",
            "domain:smtown.com",
            "domain:starship-ent.com",
            "domain:ador.world",
            "domain:woolliment.com",
            "domain:yna.co.kr",
            "domain:billboard.com",
            "domain:circlechart.kr",
        }
        self.assertEqual({classify_source(key) for key in keys}, {RELIABLE})

    def test_all_reliable_sources_classify_as_reliable(self):
        for key in RELIABLE_SOURCES:
            self.assertEqual(classify_source(key), RELIABLE, f"{key} did not classify as RELIABLE")

    def test_unknown_source_is_not_eligible(self):
        self.assertEqual(classify_source("domain:example.net"), UNREVIEWED)

    def test_p854_uses_registrable_domain(self):
        self.assertEqual(
            registrable_domain("https://newsroom.jype.com/path"), "jype.com"
        )
        self.assertEqual(
            registrable_domain("https://music.example.co.kr/path"), "example.co.kr"
        )
        self.assertEqual(registrable_domain("https://namu.wiki/page"), "namu.wiki")

    def test_p854_rejects_schemeless_urls_and_uncovered_suffixes(self):
        self.assertIsNone(registrable_domain("javascript://jype.com"))
        self.assertIsNone(registrable_domain("//jype.com"))
        self.assertIsNone(registrable_domain("https://example.co.in/path"))
        self.assertIsNone(registrable_domain("https://project.github.io/page"))
        self.assertIsNone(registrable_domain("https://127.0.0.1/page"))

    def test_domain_allowlist_cannot_bypass_suffix_validation(self):
        self.assertEqual(classify_source("domain:github.io"), UNREVIEWED)
        self.assertEqual(classify_source("domain:example.co.in"), UNREVIEWED)

    def test_p248_and_p854_are_normalized_before_assessment(self):
        raw = {
            "claims": {
                "P123": [
                    {
                        "id": "Q1$statement",
                        "rank": "normal",
                        "mainsnak": {
                            "snaktype": "value",
                            "datavalue": {
                                "type": "wikibase-entityid",
                                "value": {"id": "Q2"},
                            },
                        },
                        "references": [
                            {
                                "hash": "reference",
                                "snaks": {
                                    "P248": [
                                        {
                                            "snaktype": "value",
                                            "datavalue": {
                                                "type": "wikibase-entityid",
                                                "value": {"id": "Q37312"},
                                            },
                                        }
                                    ],
                                    "P854": [
                                        {
                                            "snaktype": "value",
                                            "datavalue": {
                                                "type": "string",
                                                "value": "https://www.imdb.com/name/nm1/",
                                            },
                                        }
                                    ],
                                },
                            }
                        ],
                    }
                ]
            }
        }
        parsed = parse_statements(raw, ["P123"])[0]
        self.assertEqual(
            parsed.references[0].source_keys,
            ("wikidata:Q37312", "domain:imdb.com"),
        )
        assessment = assess_references(parsed)
        self.assertEqual(assessment.evidence, ())
        self.assertEqual(assessment.rejection_reason, "unreliable_reference_source")

    def test_invalid_reference_origin_cannot_hide_behind_reliable_domain(self):
        raw = {
            "claims": {
                "P123": [
                    {
                        "id": "Q1$statement",
                        "rank": "normal",
                        "mainsnak": {
                            "snaktype": "value",
                            "datavalue": {
                                "type": "wikibase-entityid",
                                "value": {"id": "Q2"},
                            },
                        },
                        "references": [
                            {
                                "hash": "reference",
                                "snaks": {
                                    "P854": [
                                        {
                                            "snaktype": "value",
                                            "datavalue": {
                                                "type": "string",
                                                "value": "https://www.jype.com/artist",
                                            },
                                        },
                                        {
                                            "snaktype": "value",
                                            "datavalue": {
                                                "type": "string",
                                                "value": "//unknown.example/source",
                                            },
                                        },
                                    ]
                                },
                            }
                        ],
                    }
                ]
            }
        }
        parsed = parse_statements(raw, ["P123"])[0]
        self.assertEqual(
            parsed.references[0].source_keys,
            ("domain:jype.com", "invalid:P854"),
        )
        assessment = assess_references(parsed)
        self.assertEqual(assessment.evidence, ())
        self.assertEqual(assessment.rejection_reason, "unreviewed_reference_source")


if __name__ == "__main__":
    unittest.main()
