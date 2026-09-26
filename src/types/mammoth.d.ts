declare module 'mammoth' {
  export interface MammothMessage {
    type: string;
    message: string;
  }

  export interface RawTextResult {
    value: string;
    messages: MammothMessage[];
  }

  export function extractRawText(input: { buffer: Buffer }): Promise<RawTextResult>;

  export function convertToHtml(input: { buffer: Buffer }): Promise<{ value: string; messages: MammothMessage[] }>;
}
