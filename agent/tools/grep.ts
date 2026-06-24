// Disable Eve's built-in `grep` tool (audit C3). Part of the file-I/O suite the ranger never uses.
import { disableTool } from 'eve/tools';

export default disableTool();
