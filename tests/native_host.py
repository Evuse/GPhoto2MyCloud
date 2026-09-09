from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

path = Path(__file__).parents[1] / "native-host" / "gphoto2mycloud_host.py"
spec = spec_from_file_location("gphoto2mycloud_host", path)
module = module_from_spec(spec)
spec.loader.exec_module(module)
digest, handle, unique_target = module.digest, module.handle, module.unique_target
