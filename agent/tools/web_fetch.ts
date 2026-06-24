// Disable Eve's built-in `web_fetch` tool (audit C3). The ranger answers from graph-grounded NPS data
// via its domain tools; arbitrary URL fetching is an SSRF/abuse surface it never needs.
import { disableTool } from 'eve/tools';

export default disableTool();
