// Disable Eve's built-in `web_search` tool (audit C3). Provider-billed web search is a free-proxy
// surface; the ranger stays on graph-grounded parks data, so it never needs it.
import { disableTool } from 'eve/tools';

export default disableTool();
