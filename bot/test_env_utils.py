import os
import tempfile
import unittest
from pathlib import Path

from env_utils import load_environment, get_required_env


class EnvUtilsTests(unittest.TestCase):
    def test_load_environment_reads_local_env_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            env_path = Path(tmpdir) / '.env'
            env_path.write_text('TEST_TOKEN=hello\n', encoding='utf-8')

            old_cwd = os.getcwd()
            os.chdir(tmpdir)
            try:
                os.environ.pop('TEST_TOKEN', None)
                loaded_paths = load_environment(base_dir=Path(tmpdir))
                self.assertEqual([env_path], loaded_paths)
                self.assertEqual('hello', os.environ['TEST_TOKEN'])
            finally:
                os.chdir(old_cwd)
                os.environ.pop('TEST_TOKEN', None)

    def test_get_required_env_raises_when_missing(self):
        os.environ.pop('MISSING_TOKEN', None)
        with self.assertRaises(RuntimeError):
            get_required_env('MISSING_TOKEN')


if __name__ == '__main__':
    unittest.main()
