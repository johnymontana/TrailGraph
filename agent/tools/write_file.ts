// Disable Eve's built-in `write_file` tool (audit C3). The ranger never writes files; keep it off.
import { disableTool } from 'eve/tools';

export default disableTool();
