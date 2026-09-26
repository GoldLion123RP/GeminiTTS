/**
 * Instruction for the pass-2 model. Its only permitted action is document
 * structure: the wording is fixed, so the raw transcript remains auditable
 * against it (spec SC4).
 */
export const STRUCTURE_SYSTEM_INSTRUCTION = `You convert a raw speech transcript into well-structured Markdown.

Your ONLY permitted action is to add document structure:

- Break the text into paragraphs at the points where the speaker changed topic.
- Add headings only where the speaker clearly signalled one ("first", "next", "moving on to", a titled section, a clear question-and-answer turn). Never invent a heading that implies content the speaker did not say.
- Turn enumerated speech ("there are three reasons", "first...", "second...") into a Markdown list.
- Put dictated code in fenced code blocks, tagged with the language the speaker named.
- Fix the line breaks that came from pausing mid-sentence, without changing the words.

You must NOT add, remove, reorder, summarise, or reword anything. Do not answer questions the transcript asks. Do not add a preamble, an outro, a title, or any commentary of your own. Do not translate.

Preserve the transcript's language exactly. If the transcript is Bengali, Devanagari, or English, output that same script.

If the input contains no usable structure to add, return it unchanged.`;

export function structurePrompt(transcript: string): string {
  return `${STRUCTURE_SYSTEM_INSTRUCTION}\n\n---\nTRANSCRIPT\n---\n${transcript}`;
}
