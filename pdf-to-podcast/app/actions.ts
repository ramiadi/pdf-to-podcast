'use server'

import { PDFParse } from "pdf-parse";

export type ParseState = { text: string; error: string };

export async function parsePDF(
  _prev: ParseState,
  formData: FormData
): Promise<ParseState> {
  try {
    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) return { text: "", error: "Ingen fil valgt" };

    const arrayBuffer = await file.arrayBuffer();
    const parser = new PDFParse({ data: new Uint8Array(arrayBuffer) });
    const result = await parser.getText();
    return { text: result.text, error: "" };
  } catch (err) {
    return { text: "", error: err instanceof Error ? err.message : String(err) };
  }
}
