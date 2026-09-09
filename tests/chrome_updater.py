from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

path = Path(__file__).parents[1] / "macos" / "update_chrome_extension.py"
spec = spec_from_file_location("update_chrome_extension", path)
module = module_from_spec(spec)
spec.loader.exec_module(module)
EXTENSION_ID, install_extension = module.EXTENSION_ID, module.install_extension
