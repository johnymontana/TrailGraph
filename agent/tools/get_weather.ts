import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { parkDetail } from '../../lib/queries';
import { getWeather } from '../../lib/datasources';

/**
 * Current conditions + 3-day forecast for a park (§4), via Open-Meteo by the park's coordinates.
 * Graph-grounded park lookup (R6); weather is a live fetch, so caveat that it can change.
 */
export default defineTool({
  description: "Get current weather + a 3-day forecast for a park by its parkCode (helps time a visit).",
  inputSchema: z.object({ parkCode: z.string() }),
  async execute({ parkCode }) {
    const park = await parkDetail(parkCode);
    if (!park || park.lat == null || park.lng == null) {
      return { kind: 'map_snippet', data: { error: `No coordinates for ${parkCode}` } };
    }
    const weather = await getWeather(park.lat as number, park.lng as number);
    if (!weather) return { kind: 'map_snippet', data: { error: 'Weather unavailable right now.' } };
    return { kind: 'map_snippet', data: { park: park.name, ...weather } };
  },
});
