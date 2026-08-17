import unittest
import json
from .schema import get_json_schema

class TestDirector(unittest.TestCase):
    def test_schema_validity(self):
        schema = get_json_schema()
        self.assertIn("properties", schema)
        self.assertEqual(schema["type"], "object")
        
    def test_cache_key(self):
        from .cache import get_cache_key
        key1 = get_cache_key("script 1", "finance", "model-1", "1.0", "low")
        key2 = get_cache_key("script 1", "finance", "model-1", "1.0", "low")
        self.assertEqual(key1, key2)

if __name__ == "__main__":
    unittest.main()
