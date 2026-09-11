from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

path = Path(__file__).parents[1] / "native-host" / "gphoto2mycloud_host.py"
spec = spec_from_file_location("gphoto2mycloud_host", path)
module = module_from_spec(spec)
spec.loader.exec_module(module)
checkpoint_page, digest, extract_download, handle, preserve_incomplete_archive, safe_relative, unique_target = (
    module.checkpoint_page, module.digest, module.extract_download, module.handle, module.preserve_incomplete_archive,
    module.safe_relative, module.unique_target
)
