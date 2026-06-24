import { defineTool } from 'eve/tools';
import { z } from 'zod';

/**
 * Ask the user ONE clarifying multiple-choice question, rendered in chat as an interactive card with
 * clickable option chips (D5). This is a passthrough tool — it has no graph side-effect; it just echoes
 * the question back as a `question_card` for the UI to render. After calling it, END the turn and wait
 * for the user's choice (it arrives as their next message); do not repeat the question in prose.
 */
export default defineTool({
  description:
    "Ask the user ONE clarifying multiple-choice question when their request is ambiguous and you can't proceed well without their answer. Renders as interactive option chips the user taps. Set allowFreeform when a typed answer also makes sense. After calling this, STOP and wait for their reply — do not repeat the question or guess an answer.",
  inputSchema: z.object({
    prompt: z.string().describe('The question to ask, e.g. "What kind of photography interests you most?"'),
    options: z
      .array(
        z.object({
          id: z.string().describe('Stable short id for the option, e.g. "landscape".'),
          label: z.string().describe('Short label shown on the chip, e.g. "🌄 Landscape & golden hour".'),
          description: z.string().optional().describe('One-line elaboration shown under the label.'),
        }),
      )
      .min(2)
      .max(6)
      .describe('2–6 mutually-exclusive choices.'),
    allowFreeform: z
      .boolean()
      .optional()
      .describe('True if the user can also type their own answer instead of picking a chip.'),
  }),
  async execute({ prompt, options, allowFreeform }) {
    // Passthrough: echo the question so the chat renders the interactive card. No graph write (cf.
    // save_preference, which does). The user's tapped/typed answer returns as their next message.
    return { kind: 'question_card', data: { prompt, options, allowFreeform: allowFreeform ?? false } };
  },
});
