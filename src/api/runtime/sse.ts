import type { AgUiEvent, StreamedEvent } from './types';
export async function* parseSseStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<StreamedEvent> {
  const reader = stream.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read(); buffer += decoder.decode(value || new Uint8Array(), { stream: !done }); buffer = buffer.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary).replace(/\r/g, ''); buffer = buffer.slice(boundary + 2); boundary = buffer.indexOf('\n\n');
        if (!frame || frame.startsWith(':')) continue;
        let id: string | undefined; const data: string[] = [];
        for (const line of frame.split('\n')) { if (line.startsWith('id:')) id = line.slice(3).trim(); if (line.startsWith('data:')) data.push(line.slice(5).trimStart()); }
        if (!data.length) continue;
        const event = JSON.parse(data.join('\n')) as AgUiEvent; const eventId = id || event.rawEvent?.eventId; yield { event, eventId };
      }
      if (done) break;
    }
  } finally { reader.releaseLock(); }
}
