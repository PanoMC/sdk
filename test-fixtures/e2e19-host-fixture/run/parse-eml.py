#!/usr/bin/env python3
"""Parses one .eml with the stdlib `email` package and prints JSON: decoded headers, text parts and attachments (with sha256 of the decoded bytes)."""
import sys, json, hashlib
from email import policy
from email.parser import BytesParser
from email.header import decode_header, make_header

raw = open(sys.argv[1], 'rb').read()
msg = BytesParser(policy=policy.default).parsebytes(raw)

def hdr(name):
    v = msg.get_all(name)
    return None if v is None else [str(x) for x in v]

parts, attachments = [], []
for part in msg.walk():
    if part.is_multipart():
        continue
    disp = part.get_content_disposition()
    payload = part.get_payload(decode=True) or b''
    if disp == 'attachment':
        attachments.append({
            'name': part.get_filename(),
            'contentType': part.get_content_type(),
            'size': len(payload),
            'sha256': hashlib.sha256(payload).hexdigest(),
            'head': payload[:8].hex(),
        })
    elif disp == 'inline' and part.get_content_maintype() == 'image':
        parts.append({'contentType': part.get_content_type(), 'inline': True, 'size': len(payload)})
    else:
        parts.append({'contentType': part.get_content_type(), 'charset': part.get_content_charset(), 'text': payload.decode(part.get_content_charset() or 'utf-8', 'replace')})

print(json.dumps({
    'subject': str(make_header(decode_header(msg['Subject']))) if msg['Subject'] else None,
    'to': hdr('To'), 'from': hdr('From'), 'replyTo': hdr('Reply-To'),
    'headerNames': [k for k in msg.keys()],
    'contentType': msg.get_content_type(),
    'parts': parts, 'attachments': attachments,
}, ensure_ascii=False))
