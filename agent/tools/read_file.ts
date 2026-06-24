// Disable Eve's built-in `read_file` tool (audit C3). The ranger has no filesystem use case; disabling
// the whole file-I/O suite (read_file/write_file/grep/glob) keeps the sandbox surface minimal.
import { disableTool } from 'eve/tools';

export default disableTool();
