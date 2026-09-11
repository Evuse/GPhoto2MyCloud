from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

path = Path(__file__).parents[1] / "native-host" / "gphoto2mycloud_host.py"
spec = spec_from_file_location("gphoto2mycloud_host", path)
module = module_from_spec(spec)
spec.loader.exec_module(module)
checkpoint_page, checkpoint_state, digest, extract_download, handle, preserve_incomplete_archive, reset_checkpoint, safe_relative, unique_target, update_checkpoint_head = (
    module.checkpoint_page, module.checkpoint_state, module.digest, module.extract_download, module.handle, module.preserve_incomplete_archive,
    module.reset_checkpoint, module.safe_relative, module.unique_target, module.update_checkpoint_head
)
