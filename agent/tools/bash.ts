// Disable Eve's built-in `bash` tool (audit C3). A parks ranger never needs a shell; leaving it on
// lets any signed-in user run sandbox commands on our bill. disableTool() takes no argument — the
// filename (`bash`) names the framework tool it opts out of (Eve validates the name at compile time).
import { disableTool } from 'eve/tools';

export default disableTool();
