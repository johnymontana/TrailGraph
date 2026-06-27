import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { campgroundDetail, bookingUrlFor, bookingWindowOpenDate } from '../../lib/campgrounds';
import { callerId } from '../../lib/agent-ctx';

/**
 * Booking-window intelligence (Campgrounds feature): for a hard-to-get campground, when does the rolling
 * reservation window open for the user's arrival date, and how far ahead does it book out? Offers to set a
 * reminder (a Camp Watch). Pure date math; books-out comes from the (gated) historical-difficulty derive.
 * userId-bound (R4). Never books.
 */
export default defineTool({
  description:
    "Tell the user when the rolling reservation window OPENS for a campground + arrival date (recreation.gov is usually 6 months out), and how far ahead it typically books. Give campgroundId + arrivalDate (YYYY-MM-DD). Offer to set a Camp Watch reminder for the morning the window opens. Never books.",
  inputSchema: z.object({
    campgroundId: z.string(),
    arrivalDate: z.string().describe('Arrival date, YYYY-MM-DD'),
    rollingWindowMonths: z.number().default(6).describe('Reservation window length; rec.gov is typically 6 months'),
  }),
  async execute({ campgroundId, arrivalDate, rollingWindowMonths }, ctx) {
    callerId(ctx);
    const cg = await campgroundDetail(campgroundId);
    if (!cg) return { kind: 'booking_window_card', data: { error: `No campground found for id "${campgroundId}".` } };
    const today = new Date().toISOString().slice(0, 10);
    const win = bookingWindowOpenDate(arrivalDate, rollingWindowMonths, today);
    return {
      kind: 'booking_window_card',
      data: {
        name: cg.name,
        arrivalDate,
        rollingWindowMonths,
        windowOpensOn: win.windowOpensOn,
        opensInPast: win.opensInPast,
        daysUntilOpen: win.daysUntilOpen,
        booksOutDays: cg.booksOutDays ?? null,
        weekendFillRate: cg.weekendFillRate ?? null,
        bookingUrl: bookingUrlFor(cg),
      },
    };
  },
});
