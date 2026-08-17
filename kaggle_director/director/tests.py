"""Contract tests. No GPU, no model — these run anywhere in about a second.

The thing worth testing here is not that pydantic works, it is that the schema
still lines up with what AETHER's parseVideoPlan() reads. That parser drops a
scene with no numeric index and silently rewrites an unknown visualType, so a
drift between the two files produces an empty storyboard and no error.

    python -m unittest director.tests -v
"""

from __future__ import annotations

import json
import unittest

from .cache import get_cache_key
from .inference import strip_thinking
from .schema import VideoPlan, get_json_schema, plan_violations, scene_violations

# Mirrors the vocabularies in public/prompts.js. If a test here fails after you
# edit that file, the fix is to change both, not to loosen the test.
AETHER_VISUAL_TYPES = {
    "stock_video", "stock_photo", "stock_text", "editorial_text",
    "t2v", "broll", "presenter",
    "stickman", "whiteboard", "chart", "map", "timeline", "diagram",
}
AETHER_SCENE_FIELDS = {
    "index", "visualType", "stockRequirements", "textOverlay", "graphic",
    "hostOverlay", "shotType", "cameraMovement", "motion", "emotion",
    "transition", "note",
    # Present only when the narration has been transcribed. Validated against
    # the audio duration by public/transcription/timing.js, never trusted raw.
    "timelineStart", "timelineEnd",
}

MINIMAL_PLAN = {
    "strategy": "Footage for the concrete beats, a chart for the one number.",
    "warnings": [],
    "scenes": [
        {
            "index": 0,
            "visualType": "stock_video",
            "stockRequirements": {
                "concept": "A shopper faced with higher prices.",
                "queries": ["woman shopping for groceries", "supermarket price label close up"],
                "fallbackQueries": ["grocery store aisle"],
                "subjectCategory": "HUMAN",
                "minimumDuration": 3.0,
                # A present-day beat, so it names modern libraries. Required
                # since 2.1: a stock beat with no source decision routes
                # nowhere, and every library then gets the same generic search.
                "sourceStrategy": "modern_stock",
                "preferredSources": ["pexels", "pixabay"],
            },
            "shotType": "Medium",
            "cameraMovement": "Slow Push In",
            "motion": "She lifts an item and puts it back.",
            "emotion": "resigned",
            "transition": "cut",
        },
        {
            "index": 1,
            "visualType": "chart",
            "graphic": {
                "title": "Food prices",
                "subtitle": "",
                "items": ["2021: 61", "2024: 87"],
            },
            "transition": "dissolve",
        },
    ],
}


class TestSchemaShape(unittest.TestCase):
    def test_json_schema_is_object_with_scenes(self):
        schema = get_json_schema()
        self.assertEqual(schema["type"], "object")
        self.assertIn("scenes", schema["properties"])

    def test_objects_forbid_extra_keys(self):
        """Guided decoding follows the grammar; an open object invites invention."""

        def walk(node):
            if isinstance(node, dict):
                if node.get("type") == "object":
                    self.assertIs(
                        node.get("additionalProperties"), False,
                        msg=f"object left open: {json.dumps(node)[:120]}",
                    )
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)

        walk(get_json_schema())

    def test_inlined_schema_has_no_refs(self):
        """llama.cpp compiles the schema to a grammar and chokes on $ref."""
        blob = json.dumps(get_json_schema(inline=True))
        self.assertNotIn("$ref", blob)
        self.assertNotIn("$defs", blob)

    def test_inlined_schema_keeps_the_vocabulary(self):
        """Inlining must not lose the enums that keep the model in bounds."""
        scene = get_json_schema(inline=True)["properties"]["scenes"]["items"]
        self.assertEqual(set(scene["properties"]["visualType"]["enum"]), AETHER_VISUAL_TYPES)
        self.assertEqual(set(scene["properties"]), AETHER_SCENE_FIELDS)

    def test_inlined_schema_still_forbids_extra_keys(self):
        def walk(node):
            if isinstance(node, dict):
                if node.get("type") == "object":
                    self.assertIs(node.get("additionalProperties"), False)
                for value in node.values():
                    walk(value)
            elif isinstance(node, list):
                for value in node:
                    walk(value)

        walk(get_json_schema(inline=True))

    def test_scene_fields_match_aether_parser(self):
        fields = set(VideoPlan.model_json_schema()["$defs"]["Scene"]["properties"])
        self.assertEqual(
            fields, AETHER_SCENE_FIELDS,
            "Scene fields drifted from parseVideoPlan() in public/prompts.js",
        )

    def test_visual_types_match_aether_vocabulary(self):
        enum = set(VideoPlan.model_json_schema()["$defs"]["Scene"]["properties"]["visualType"]["enum"])
        self.assertEqual(
            enum, AETHER_VISUAL_TYPES,
            "visualType drifted from VISUAL_TYPES in public/prompts.js",
        )


class TestValidation(unittest.TestCase):
    def test_minimal_plan_validates(self):
        plan = VideoPlan(**MINIMAL_PLAN)
        self.assertEqual(len(plan.scenes), 2)
        self.assertEqual(plan.scenes[0].stockRequirements.queries[0], "woman shopping for groceries")

    def test_defaults_fill_in(self):
        """AETHER reads every scene field, so none of them may be absent."""
        scene = VideoPlan(**MINIMAL_PLAN).scenes[1]
        self.assertEqual(scene.hostOverlay, "none")
        self.assertEqual(scene.shotType, "Medium")
        self.assertEqual(scene.cameraMovement, "Static")

    def test_index_is_required(self):
        """A scene with no index is dropped by AETHER, so reject it here."""
        broken = json.loads(json.dumps(MINIMAL_PLAN))
        del broken["scenes"][0]["index"]
        with self.assertRaises(Exception):
            VideoPlan(**broken)

    def test_unknown_visual_type_rejected(self):
        broken = json.loads(json.dumps(MINIMAL_PLAN))
        broken["scenes"][0]["visualType"] = "ai_generated_clip"
        with self.assertRaises(Exception):
            VideoPlan(**broken)

    def test_empty_scenes_rejected(self):
        with self.assertRaises(Exception):
            VideoPlan(strategy="", warnings=[], scenes=[])


class TestPayloadMatchesType(unittest.TestCase):
    """The failure seen on Kaggle: a type chosen without the payload it draws from.

    The grammar cannot express this rule — JSON Schema has no way to make one
    field's presence depend on another field's value — so it has to be caught
    after generation and either re-asked or repaired.
    """

    def _scene(self, **over):
        base = {"index": 0, "visualType": "broll"}
        base.update(over)
        return base

    def test_editorial_text_without_overlay_is_a_violation(self):
        problems = scene_violations(self._scene(visualType="editorial_text"))
        self.assertTrue(any("textOverlay.text" in p for p in problems), problems)

    def test_stock_video_without_queries_is_a_violation(self):
        problems = scene_violations(self._scene(visualType="stock_video"))
        self.assertTrue(any("stockRequirements.queries" in p for p in problems), problems)

    def test_chart_without_items_is_a_violation(self):
        problems = scene_violations(self._scene(visualType="chart"))
        self.assertTrue(any("graphic.items" in p for p in problems), problems)

    def test_stock_text_needs_both(self):
        # Names the two things it means rather than counting problems. The count
        # was a proxy that broke the moment the contract grew a third rule, and
        # a test that fails when an unrelated rule is added is a test that will
        # be edited to make it pass rather than read.
        problems = scene_violations(self._scene(visualType="stock_text"))
        self.assertTrue(any("stockRequirements.queries" in p for p in problems), problems)
        self.assertTrue(any("textOverlay.text" in p for p in problems), problems)

    def test_stock_beat_without_a_source_decision_is_a_violation(self):
        """Left optional, the model omits it and nothing routes the beat.

        Measured against the live 27B: with these fields optional, every beat
        came back with no preferred source at all — including one about the
        Second World War — so the film archive was never reachable.
        """
        problems = scene_violations(self._scene(visualType="stock_video"))
        self.assertTrue(any("preferredSources" in p for p in problems), problems)
        self.assertTrue(any("sourceStrategy" in p for p in problems), problems)

    def test_archive_beat_needs_archive_phrased_queries(self):
        """An archive is catalogued by what a film IS, not by what it shows."""
        problems = scene_violations(self._scene(
            visualType="stock_video",
            stockRequirements={
                "concept": "wartime production",
                "queries": ["factory workers"],
                "sourceStrategy": "archival",
                "preferredSources": ["archive_org"],
                "archiveQueries": [],
            },
        ))
        self.assertTrue(any("archiveQueries" in p for p in problems), problems)

    def test_archive_beat_with_archive_queries_is_clean(self):
        problems = scene_violations(self._scene(
            visualType="stock_video",
            stockRequirements={
                "concept": "wartime production",
                "queries": ["factory workers"],
                "sourceStrategy": "archival",
                "preferredSources": ["archive_org"],
                "archiveQueries": ["1940s wartime factory newsreel"],
            },
        ))
        self.assertEqual(problems, [])

    def test_modern_beat_needs_no_archive_queries(self):
        problems = scene_violations(self._scene(
            visualType="stock_video",
            stockRequirements={
                "concept": "shopping today",
                "queries": ["supermarket checkout"],
                "sourceStrategy": "modern_stock",
                "preferredSources": ["pexels", "pixabay"],
            },
        ))
        self.assertEqual(problems, [])

    def test_types_needing_nothing_are_clean(self):
        for visual in ("t2v", "broll", "presenter"):
            self.assertEqual(scene_violations(self._scene(visualType=visual)), [])

    def test_missing_index_is_a_violation(self):
        scene = self._scene()
        del scene["index"]
        self.assertTrue(any("index" in p for p in scene_violations(scene)))

    def test_a_good_plan_has_no_violations(self):
        self.assertEqual(plan_violations(MINIMAL_PLAN), [])

    def test_plan_violations_reports_the_scene_index(self):
        broken = json.loads(json.dumps(MINIMAL_PLAN))
        broken["scenes"][1]["graphic"] = None
        found = plan_violations(broken)
        self.assertEqual([i for i, _ in found], [1])

    def test_model_rejects_a_mismatched_scene(self):
        """Pydantic must refuse it too, or a bad plan reaches AETHER anyway."""
        broken = json.loads(json.dumps(MINIMAL_PLAN))
        broken["scenes"][0]["stockRequirements"] = None
        with self.assertRaises(Exception):
            VideoPlan(**broken)


class TestRepair(unittest.TestCase):
    """The fallback when the model will not fix its own work."""

    def setUp(self):
        from .inference import DirectorInference

        self.repair = DirectorInference._repair

    def test_caption_is_taken_from_the_narration(self):
        plan = {"scenes": [{"index": 0, "visualType": "editorial_text"}]}
        self.repair(plan, [{"index": 0, "text": "Inflation quietly reduces what your paycheck can buy."}])
        self.assertEqual(plan["scenes"][0]["visualType"], "editorial_text")
        self.assertIn("Inflation", plan["scenes"][0]["textOverlay"]["text"])
        self.assertEqual(plan_violations(plan), [])

    def test_caption_is_capped_at_twelve_words(self):
        plan = {"scenes": [{"index": 0, "visualType": "editorial_text"}]}
        self.repair(plan, [{"index": 0, "text": " ".join(f"w{i}" for i in range(40))}])
        self.assertEqual(len(plan["scenes"][0]["textOverlay"]["text"].split()), 12)

    def test_stock_without_queries_is_demoted(self):
        plan = {"scenes": [{"index": 0, "visualType": "stock_video"}]}
        self.repair(plan, [{"index": 0, "text": "some narration"}])
        self.assertEqual(plan["scenes"][0]["visualType"], "broll")
        self.assertEqual(plan_violations(plan), [])

    def test_empty_chart_is_demoted_rather_than_drawn_blank(self):
        plan = {"scenes": [{"index": 0, "visualType": "chart"}]}
        self.repair(plan, [{"index": 0, "text": "no numbers here"}])
        self.assertEqual(plan["scenes"][0]["visualType"], "broll")

    def test_missing_index_is_supplied(self):
        plan = {"scenes": [{"visualType": "broll"}]}
        self.repair(plan, [])
        self.assertEqual(plan["scenes"][0]["index"], 0)
        self.assertEqual(plan_violations(plan), [])

    def test_every_repair_is_recorded_as_a_warning(self):
        plan = {"scenes": [{"index": 0, "visualType": "chart"}]}
        notes = self.repair(plan, [])
        self.assertTrue(notes)
        self.assertEqual(plan["warnings"], notes)

    def test_repaired_plan_validates(self):
        plan = json.loads(json.dumps(MINIMAL_PLAN))
        plan["scenes"][0]["stockRequirements"] = None
        plan["scenes"][1]["graphic"] = None
        self.repair(plan, [{"index": 0, "text": "a"}, {"index": 1, "text": "b"}])
        VideoPlan(**plan)


class TestStripThinking(unittest.TestCase):
    """Recovering the answer from a reply that begins mid-thought.

    This model's chat template ends the prompt with a bare `<think>\\n`, so
    generation starts already inside the block and only the CLOSING tag is ever
    generated. A regex looking for a matched pair matches nothing, and /generate
    returned several hundred tokens of deliberation where a title was expected.
    """

    def test_closing_tag_with_no_opener(self):
        raw = "1. Analyse the request\n2. Draft options\n</think>\n\nWhy Your Money Buys Less"
        self.assertEqual(strip_thinking(raw), "Why Your Money Buys Less")

    def test_matched_pair_still_works(self):
        self.assertEqual(strip_thinking("<think>hmm</think>\n\nAnswer"), "Answer")

    def test_last_closing_tag_wins(self):
        raw = "think a</think>mid</think>\n\nFinal"
        self.assertEqual(strip_thinking(raw), "Final")

    def test_plain_text_is_untouched(self):
        self.assertEqual(strip_thinking("Just an answer."), "Just an answer.")

    def test_truncated_thought_yields_nothing(self):
        """No closing tag means generation stopped mid-thought — there is no answer."""
        self.assertEqual(strip_thinking("<think>still reasoning and then it stopped"), "")

    def test_answer_containing_the_word_think_survives(self):
        raw = "</think>\n\nI think inflation is the answer."
        self.assertEqual(strip_thinking(raw), "I think inflation is the answer.")

    def test_empty_and_none(self):
        self.assertEqual(strip_thinking(""), "")
        self.assertEqual(strip_thinking(None), "")

    def test_json_after_a_thought_is_preserved(self):
        raw = '</think>\n\n{"scenes": []}'
        self.assertEqual(strip_thinking(raw), '{"scenes": []}')


class TestCache(unittest.TestCase):
    def test_key_is_stable(self):
        args = ("script", "finance", "model-1", "2.0", "")
        self.assertEqual(get_cache_key(*args), get_cache_key(*args))

    def test_schema_version_changes_key(self):
        a = get_cache_key("s", "finance", "m", "1.0", "")
        b = get_cache_key("s", "finance", "m", "2.0", "")
        self.assertNotEqual(a, b, "a schema change must miss the cache, not serve a stale shape")


if __name__ == "__main__":
    unittest.main()
