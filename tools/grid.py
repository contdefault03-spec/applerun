# Usage: python3 tools/grid.py out.png img1 img2 ... (2 columns, 640x360 tiles)
import sys
from PIL import Image
out, files = sys.argv[1], sys.argv[2:]
rows = (len(files) + 1) // 2
W = Image.new('RGB', (1280, 360 * rows))
for i, f in enumerate(files):
    W.paste(Image.open(f).convert('RGB').resize((640, 360)), ((i % 2) * 640, (i // 2) * 360))
W.save(out)
