"""Convert the existing four-square brand into Windows icon sizes, using stdlib."""
from pathlib import Path
import struct
import zlib


def inside(x, y, left, top, right, bottom, radius):
    cx = min(max(x, left + radius), right - radius)
    cy = min(max(y, top + radius), bottom - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def chunk(kind, data):
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def png(size):
    rows = bytearray()
    squares = [(7, 7, 15, 15, (255, 255, 255, 255)),
               (17, 7, 25, 15, (147, 188, 182, 255)),
               (7, 17, 15, 25, (200, 223, 219, 255)),
               (17, 17, 25, 25, (230, 240, 238, 255))]
    for y in range(size):
        rows.append(0)
        for x in range(size):
            # Four samples per pixel keep the rounded corners clean at small sizes.
            samples = []
            for dx, dy in [(0.25, 0.25), (0.75, 0.25), (0.25, 0.75), (0.75, 0.75)]:
                sx, sy = (x + dx) * 32 / size, (y + dy) * 32 / size
                color = (15, 107, 91, 255) if inside(sx, sy, 0, 0, 32, 32, 8) else (0, 0, 0, 0)
                for left, top, right, bottom, fill in squares:
                    if inside(sx, sy, left, top, right, bottom, 2):
                        color = fill
                samples.append(color)
            rows.extend(round(sum(sample[c] for sample in samples) / 4) for c in range(4))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(bytes(rows), 9)) + chunk(b'IEND', b''))


sizes = [16, 24, 32, 48, 64, 128, 256]
images = [png(size) for size in sizes]
offset = 6 + 16 * len(sizes)
entries = []
for size, data in zip(sizes, images):
    entries.append(struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset))
    offset += len(data)
destination = Path(__file__).resolve().parents[1] / 'assets' / 'app.ico'
destination.write_bytes(struct.pack('<HHH', 0, 1, len(sizes)) + b''.join(entries) + b''.join(images))
print(destination)
