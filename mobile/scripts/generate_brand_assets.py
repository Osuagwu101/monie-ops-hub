from io import BytesIO
from pathlib import Path
from urllib.request import urlopen

from PIL import Image, ImageDraw, ImageFont

LOGO_URL = "https://eu-west-2.graphassets.com/AxQ8YTi9LTCrOeR0pPuwfz/cmk3yx2dd15il07lco5cye9zy"
ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
ASSETS.mkdir(parents=True, exist_ok=True)

with urlopen(LOGO_URL, timeout=30) as response:
    logo = Image.open(BytesIO(response.read())).convert("RGBA")

font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
font = ImageFont.truetype(font_path, 116)
blue = (3, 87, 238, 255)
white = (255, 255, 255, 255)


def compose(path: Path, size: int = 1024, transparent: bool = False) -> None:
    background = (255, 255, 255, 0) if transparent else white
    canvas = Image.new("RGBA", (size, size), background)
    logo_copy = logo.copy()
    max_width = int(size * 0.78)
    max_height = int(size * 0.35)
    ratio = min(max_width / logo_copy.width, max_height / logo_copy.height)
    logo_copy = logo_copy.resize(
        (max(1, int(logo_copy.width * ratio)), max(1, int(logo_copy.height * ratio))),
        Image.Resampling.LANCZOS,
    )
    logo_x = (size - logo_copy.width) // 2
    logo_y = int(size * 0.28)
    canvas.alpha_composite(logo_copy, (logo_x, logo_y))

    draw = ImageDraw.Draw(canvas)
    text = "BRM"
    box = draw.textbbox((0, 0), text, font=font)
    text_width = box[2] - box[0]
    text_y = logo_y + logo_copy.height + int(size * 0.08)
    draw.text(((size - text_width) / 2, text_y), text, fill=blue, font=font)
    canvas.save(path, "PNG")


compose(ASSETS / "icon.png")
compose(ASSETS / "adaptive-icon.png", transparent=True)
compose(ASSETS / "splash-icon.png")
print("Generated Moniepoint BRM icon, adaptive icon and splash assets")
