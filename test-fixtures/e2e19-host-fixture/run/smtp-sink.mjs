// A local SMTP sink for P-4.3: accepts every message on 127.0.0.1:<port> (no TLS, no AUTH, like a Pano mail setup with STARTTLS DISABLED),
// keeps the raw bytes of each message and parses them with the python `email` package (parse-eml.py), so the assertions read a real MIME parse.
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

// A FIXED port on purpose: MailManager builds its SMTP client lazily on the first send and never rebuilds it, so a later settings save with another port
// would not take effect until the platform restarts (recorded in evidence/E2E-19.md).
export async function startSink(port = Number(process.env.E2E19_SMTP_PORT || 18597)) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e19-smtp-'));
  const messages = [];
  const sockets = new Set();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    let inData = false;
    let chunks = [];
    let envelope = { from: null, to: [] };

    const send = (line) => socket.write(`${line}\r\n`);
    send('220 e2e19-sink ESMTP');

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      for (;;) {
        if (inData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) {
            // a message may start with the terminator itself ("\r\n.\r\n" at offset -2): keep the tail
            return;
          }
          const raw = buffer.subarray(0, end + 2);
          buffer = buffer.subarray(end + 5);
          inData = false;
          // dot-unstuffing
          const text = raw.toString('latin1').replace(/\r\n\.\./g, '\r\n.');
          const file = path.join(dir, `${messages.length + 1}.eml`);
          fs.writeFileSync(file, Buffer.from(text, 'latin1'));
          messages.push({ file, envelope });
          envelope = { from: null, to: [] };
          send('250 2.0.0 queued');
          continue;
        }

        const eol = buffer.indexOf('\r\n');
        if (eol < 0) return;
        const line = buffer.subarray(0, eol).toString('latin1');
        buffer = buffer.subarray(eol + 2);
        const cmd = line.slice(0, 4).toUpperCase();

        if (cmd === 'EHLO') {
          socket.write('250-e2e19-sink\r\n250-8BITMIME\r\n250 SIZE 20971520\r\n');
        } else if (cmd === 'HELO') send('250 e2e19-sink');
        else if (cmd === 'MAIL') {
          envelope.from = line.slice(10).replace(/[<>]/g, '').split(' ')[0];
          send('250 2.1.0 ok');
        } else if (cmd === 'RCPT') {
          envelope.to.push(line.slice(8).replace(/[<>]/g, '').split(' ')[0]);
          send('250 2.1.5 ok');
        } else if (cmd === 'DATA') {
          inData = true;
          send('354 end with <CRLF>.<CRLF>');
        } else if (cmd === 'RSET') {
          envelope = { from: null, to: [] };
          send('250 ok');
        } else if (cmd === 'NOOP') send('250 ok');
        else if (cmd === 'QUIT') {
          send('221 bye');
          socket.end();
          return;
        } else send('502 command not implemented');
      }
    });
  });

  await new Promise((resolve, reject) => server.listen(port, '127.0.0.1', resolve).on('error', reject));

  return {
    port: server.address().port,
    messages,
    /** The python `email` parse of message `n` (1-based): headers, text parts, attachments (name, content type, size, sha256, hex of the first bytes). */
    parse(n) {
      const m = messages[n - 1];
      if (!m) throw new Error(`no message ${n}`);
      const out = execFileSync('python3', [path.join(here, 'parse-eml.py'), m.file], { encoding: 'utf8' });
      return { ...JSON.parse(out), envelope: m.envelope, rawFile: m.file };
    },
    raw: (n) => fs.readFileSync(messages[n - 1].file),
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}
