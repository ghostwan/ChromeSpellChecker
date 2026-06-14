#!/usr/bin/env python3
"""Generate placeholder PNG icons — run once at setup time."""
import struct, zlib, os, math

def make_chunk(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

def make_png(pixels, w, h):
    sig  = b'\x89PNG\r\n\x1a\n'
    ihdr = make_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    raw  = b''.join(b'\x00' + bytes(px for col in row for px in col) for row in pixels)
    idat = make_chunk(b'IDAT', zlib.compress(raw, 9))
    iend = make_chunk(b'IEND', b'')
    return sig + ihdr + idat + iend

def render_icon(size):
    """Blue circle, white 'A' with wavy underline."""
    BG   = (74, 144, 226, 255)   # #4a90e2
    FG   = (255, 255, 255, 255)
    NONE = (0, 0, 0, 0)
    cx, cy, r = size / 2, size / 2, size / 2

    pixels = []
    for y in range(size):
        row = []
        for x in range(size):
            dx, dy = x - cx + 0.5, y - cy + 0.5
            if dx*dx + dy*dy <= r*r:
                row.append(BG)
            else:
                row.append(NONE)
        pixels.append(row)

    # Draw a simple "A" scaled to the icon
    # Define "A" as line segments in normalised coords [0,1]
    def plot(x, y, col):
        ix, iy = int(x), int(y)
        if 0 <= ix < size and 0 <= iy < size:
            pixels[iy][ix] = col

    def line(x0, y0, x1, y1, col, thick=1):
        steps = max(abs(x1-x0), abs(y1-y0), 1) * 3
        for i in range(int(steps)+1):
            t = i / steps
            fx = x0 + t*(x1-x0)
            fy = y0 + t*(y1-y0)
            for ty in range(-thick//2, thick//2+1):
                for tx in range(-thick//2, thick//2+1):
                    plot(fx+tx, fy+ty, col)

    m = size * 0.15          # left margin
    top = size * 0.15
    bot = size * 0.78
    mid = top + (bot - top) * 0.48
    th  = max(1, int(size * 0.09))

    line(m, bot, size/2, top, FG, th)          # left leg
    line(size/2, top, size-m, bot, FG, th)     # right leg
    line(m + (size-2*m)*0.25, mid,              # crossbar
         size-m - (size-2*m)*0.25, mid, FG, th)

    # Wavy underline (3 bumps)
    uy = size * 0.89
    amp = size * 0.05
    uw = size * 0.70
    ux0 = (size - uw) / 2
    prev_x, prev_y = None, None
    for i in range(int(uw)+1):
        fx = ux0 + i
        fy = uy + math.sin(i / uw * math.pi * 3) * amp
        if prev_x is not None:
            line(prev_x, prev_y, fx, fy, (255, 200, 50, 255), max(1, th-1))
        prev_x, prev_y = fx, fy

    return pixels

os.makedirs('assets/icons', exist_ok=True)
for size in [16, 32, 48, 128]:
    px = render_icon(size)
    path = f'assets/icons/icon{size}.png'
    with open(path, 'wb') as f:
        f.write(make_png(px, size, size))
    print(f'  {path}  ({size}x{size})')
print('Done.')
