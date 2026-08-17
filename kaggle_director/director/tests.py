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
from .schema import VideoPlan, get_json_schema

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
