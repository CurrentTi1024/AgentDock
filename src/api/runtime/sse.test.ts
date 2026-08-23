import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSseStream } from './sse.ts';

test('parses chunked CRLF SSE frames and preserves event ids', async () => {
  const encoder = new TextEncoder();
  const chunks = ['id: 1\r\ndata: {"type":"RUN_', 'STARTED"}\r\n\r\nid: 2\r\ndata: {"type":"RUN_FINISHED"}\r\n\r\n'];
  const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } });
  const events = [];
  for await (const event of parseSseStream(stream)) events.push(event);
  assert.deepEqual(events.map((item) => [item.eventId, item.event.type]), [['1', 'RUN_STARTED'], ['2', 'RUN_FINISHED']]);
});
