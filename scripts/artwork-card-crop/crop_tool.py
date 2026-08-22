"""Interactive card-art cropper with collection-aware card-frame previews.

The tool lets you choose an artwork input folder, an artwork output folder,
the collection JSON files that describe those artworks, and the card-frame
asset folder. It keeps the game's 500x500 artwork export separate from the
optional full-card PNG previews: the game can continue to render artwork and
frames as independent layers while the crop workflow can still show the
correct frame over the selected artwork.
"""

from __future__ import annotations

from datetime import datetime
import json
import math
from pathlib import Path
import re
import tkinter as tk
from tkinter import filedialog, messagebox
import tkinter.ttk as ttk
from typing import Any
import unicodedata

from PIL import Image, ImageDraw, ImageFont, ImageTk


# ============================ EASY CONFIGURATION ===========================
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent.parent

SOURCE_CANDIDATES = (
    REPO_ROOT / "assets" / "images" / "card-artwork-to-do",
    REPO_ROOT / "assets" / "images" / "card-artwork",
    REPO_ROOT / "assets" / "images" / "artwork",
)
DEFAULT_SOURCE_FOLDER = next(
    (path for path in SOURCE_CANDIDATES if path.is_dir()), SOURCE_CANDIDATES[0]
)
DEFAULT_OUTPUT_FOLDER = SCRIPT_DIR / "Output"
DEFAULT_METADATA_FOLDER = SCRIPT_DIR / "metadata"
DEFAULT_FRAME_FOLDER = REPO_ROOT / "assets" / "images" / "cards"
DEFAULT_COLLECTION_FOLDER = REPO_ROOT / "src" / "game" / "content" / "cards" / "sets"

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
COLLECTION_CONTAINER_KEYS = ("cards", "collection", "records", "items")

CROP_SIZE = 500
CARD_CANVAS_SIZE = (620, 900)
ARTWORK_POSITION = (60, 20)
CARD_PREVIEW_SCALE = 0.65
CARD_PREVIEW_SIZE = (
    round(CARD_CANVAS_SIZE[0] * CARD_PREVIEW_SCALE),
    round(CARD_CANVAS_SIZE[1] * CARD_PREVIEW_SCALE),
)
NAME_BANNER_FILE = "card-name.png"
NAME_BANNER_SIZE = (665, 198)
NAME_BANNER_POSITION = (-24, 391)
NAME_TEXT_CENTER = (319, 473)
NAME_TEXT_MAX_WIDTH = 480
NAME_TEXT_MAX_HEIGHT = 64
NAME_FONT_SIZE = 47
NAME_FONT_PATH = REPO_ROOT / "assets" / "fonts" / "belwe_bold.ttf"
THUMBNAIL_SIZE = 48
JPEG_QUALITY = 95

ZOOM_WHEEL_FACTOR = 1.1
MAX_ZOOM_SCALE = 8.0
NATURAL_ZOOM_SCALE = 1.0

FRAME_FILES = {
    "minion": "frame-minion.png",
    "spell": "frame-spell.png",
    "weapon": "frame-weapon.png",
    "hero": "frame-hero.png",
}
FALLBACK_FRAME_TYPES = ("Minion", "Spell", "Weapon", "Hero")

CANVAS_BG = "#202020"
PREPARED_FG = "#ff9800"
FIXED_FG = "#2e7d32"
NEEDS_FIX_FG = "#c62828"
UNMATCHED_FG = "#7b1fa2"
PREPARED_PREFIX = "[*] "
FIXED_PREFIX = "[x] "
NEEDS_FIX_PREFIX = "[ ] "
UNMATCHED_PREFIX = "[!] "
WINDOW_TITLE = "Card Art Cropper - 500x500 Artwork + Card Preview"
# ===========================================================================


CollectionRecord = dict[str, Any]


def cover_fit_scale(w: int, h: int, box: int = CROP_SIZE) -> float:
    return max(box / w, box / h)


def default_view_scale(w: int, h: int, box: int = CROP_SIZE) -> float:
    """Start large artwork at natural size, while smaller artwork still covers the box."""
    return max(NATURAL_ZOOM_SCALE, cover_fit_scale(w, h, box))


def initial_offset(
    w: int, h: int, scale: float, box: int = CROP_SIZE
) -> tuple[float, float]:
    return ((box - w * scale) / 2, (box - h * scale) / 2)


def clamp_offset(
    ox: float, oy: float, scale: float, w: int, h: int, box: int = CROP_SIZE
) -> tuple[float, float]:
    draw_w, draw_h = w * scale, h * scale
    return (
        min(0.0, max(box - draw_w, ox)),
        min(0.0, max(box - draw_h, oy)),
    )


def zoom_at(
    scale: float,
    ox: float,
    oy: float,
    factor: float,
    anchor_x: float,
    anchor_y: float,
    w: int,
    h: int,
    box: int = CROP_SIZE,
) -> tuple[float, float, float]:
    cover = cover_fit_scale(w, h, box)
    new_scale = min(max(scale * factor, cover), max(MAX_ZOOM_SCALE, cover))
    source_x = (anchor_x - ox) / scale
    source_y = (anchor_y - oy) / scale
    new_ox = anchor_x - source_x * new_scale
    new_oy = anchor_y - source_y * new_scale
    new_ox, new_oy = clamp_offset(new_ox, new_oy, new_scale, w, h, box)
    return new_scale, new_ox, new_oy


def visible_source_box(
    ox: float, oy: float, scale: float, w: int, h: int, box: int = CROP_SIZE
) -> tuple[int, int, int, int]:
    side = max(1, round(box / scale))
    side = min(side, w, h)
    left = max(0, min(round(-ox / scale), w - side))
    top = max(0, min(round(-oy / scale), h - side))
    return (left, top, left + side, top + side)


def crop_to_artwork(
    image: Image.Image, crop_box: tuple[int, int, int, int]
) -> Image.Image:
    width, height = image.size
    left, top, right, bottom = clamp_crop_box(crop_box, width, height)
    return image.crop((left, top, right, bottom)).resize(
        (CROP_SIZE, CROP_SIZE), Image.Resampling.LANCZOS
    )


def clamp_crop_box(
    crop_box: tuple[int, int, int, int], width: int, height: int
) -> tuple[int, int, int, int]:
    """Keep a crop inside the current source image.

    Pillow intentionally pads crops that extend outside an image. That is
    useful in some image-processing workflows, but it produces black borders
    for this tool. Exported artwork must always be made from real source
    pixels, so invalid coordinates are clamped before cropping.
    """
    if width < 1 or height < 1:
        raise ValueError("source image has no pixels")

    left, top, right, bottom = crop_box
    left = max(0, min(int(left), width - 1))
    top = max(0, min(int(top), height - 1))
    right = max(left + 1, min(int(right), width))
    bottom = max(top + 1, min(int(bottom), height))
    return left, top, right, bottom


def compose_card_preview(
    artwork: Image.Image,
    frame: Image.Image | None,
    name_banner: Image.Image | None = None,
    card_name: str | None = None,
    font_path: Path | None = NAME_FONT_PATH,
) -> Image.Image:
    """Build the complete preview: artwork, frame, name banner, and card name."""
    card = Image.new("RGBA", CARD_CANVAS_SIZE, (0, 0, 0, 0))
    artwork_layer = Image.new("RGBA", CARD_CANVAS_SIZE, (0, 0, 0, 0))
    artwork_rgba = artwork.convert("RGBA")
    artwork_layer.paste(artwork_rgba, ARTWORK_POSITION, artwork_rgba)
    card = Image.alpha_composite(card, artwork_layer)
    if frame is not None:
        normalized_frame = frame.convert("RGBA").resize(
            CARD_CANVAS_SIZE, Image.Resampling.LANCZOS
        )
        card = Image.alpha_composite(card, normalized_frame)

    if name_banner is not None:
        normalized_banner = name_banner.convert("RGBA").resize(
            NAME_BANNER_SIZE, Image.Resampling.LANCZOS
        )
        card = _composite_layer(card, normalized_banner, NAME_BANNER_POSITION)

    if card_name:
        name_layer = Image.new("RGBA", CARD_CANVAS_SIZE, (0, 0, 0, 0))
        draw = ImageDraw.Draw(name_layer)
        font = _fit_name_font(card_name, font_path)
        draw.text(
            NAME_TEXT_CENTER,
            card_name,
            font=font,
            fill=(255, 255, 255, 255),
            anchor="mm",
            align="center",
            stroke_width=7,
            stroke_fill=(0, 0, 0, 255),
        )
        card = Image.alpha_composite(card, name_layer)
    return card


def make_thumbnail(path: Path, size: int = THUMBNAIL_SIZE) -> ImageTk.PhotoImage | None:
    try:
        with Image.open(path) as image:
            thumbnail = image.convert("RGB")
            thumbnail.thumbnail((size, size), Image.Resampling.LANCZOS)
            return ImageTk.PhotoImage(thumbnail)
    except Exception:
        return None


def source_files(folder: Path) -> list[Path]:
    """Return supported image files from the selected input folder."""
    try:
        files = [
            path
            for path in folder.iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        ]
    except OSError:
        return []
    return sorted(files, key=lambda path: (path.name.casefold(), path.name))


def normalize_card_id(value: object) -> str:
    return str(value).strip().casefold()


def normalize_match_text(value: object) -> str:
    """Normalize human-readable names for artwork/collection matching."""
    text = unicodedata.normalize("NFKD", str(value)).encode("ascii", "ignore").decode()
    text = text.casefold().replace("_", " ").replace("-", " ")
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.split())


def artwork_match_key(stem: str) -> str:
    """Normalize common downloaded-artwork filename decorations."""
    cleaned = re.sub(r"^\d+px[-_]", "", stem, flags=re.IGNORECASE)
    cleaned = re.sub(r"(?:[_\s-]+)full$", "", cleaned, flags=re.IGNORECASE)
    return normalize_match_text(cleaned)


def display_name_from_stem(stem: str) -> str:
    """Create a readable title when collection data is unavailable."""
    cleaned = re.sub(r"^\d+px[-_]", "", stem, flags=re.IGNORECASE)
    cleaned = re.sub(r"(?:[_\s-]+)full$", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[_-]+", " ", cleaned).strip()
    if cleaned and cleaned == cleaned.lower():
        return cleaned.title()
    return cleaned


def _name_font(font_path: Path | None, size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    if font_path is not None and font_path.is_file():
        try:
            return ImageFont.truetype(str(font_path), size)
        except OSError:
            pass
    return ImageFont.load_default()


def _fit_name_font(name: str, font_path: Path | None) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    probe = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    for size in range(NAME_FONT_SIZE, 15, -1):
        font = _name_font(font_path, size)
        left, top, right, bottom = probe.textbbox(
            (0, 0), name, font=font, stroke_width=7
        )
        if right - left <= NAME_TEXT_MAX_WIDTH and bottom - top <= NAME_TEXT_MAX_HEIGHT:
            return font
    return _name_font(font_path, 16)


def _composite_layer(
    base: Image.Image, layer: Image.Image, position: tuple[int, int]
) -> Image.Image:
    positioned = Image.new("RGBA", CARD_CANVAS_SIZE, (0, 0, 0, 0))
    layer_rgba = layer.convert("RGBA")
    positioned.paste(layer_rgba, position, layer_rgba)
    return Image.alpha_composite(base, positioned)


def _records_from_collection_payload(
    payload: object, source_path: Path
) -> list[object]:
    if isinstance(payload, list):
        return payload

    if isinstance(payload, dict):
        for key in COLLECTION_CONTAINER_KEYS:
            records = payload.get(key)
            if isinstance(records, list):
                return records

        if "id" in payload or "cardId" in payload or "card_id" in payload:
            return [payload]

        if payload and all(isinstance(record, dict) for record in payload.values()):
            return list(payload.values())

    raise ValueError(
        f"{source_path.name}: expected a JSON array or an object containing card records"
    )


def _record_card_id(record: dict[str, object]) -> str | None:
    for key in ("id", "cardId", "card_id"):
        value = record.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def load_collection_records(
    paths: list[Path] | tuple[Path, ...],
) -> tuple[dict[str, CollectionRecord], list[str]]:
    """Load card records keyed by their case-insensitive card ID.

    The project stores each set as a JSON array, but accepting common wrapper
    keys makes the cropper useful with externally exported collection files as
    well. Hero-power records are ignored because they have no card frame.
    """
    records: dict[str, CollectionRecord] = {}
    warnings: list[str] = []

    for path in paths:
        try:
            with path.open("r", encoding="utf-8-sig") as file:
                payload = json.load(file)
            raw_records = _records_from_collection_payload(payload, path)
        except (OSError, json.JSONDecodeError, ValueError) as error:
            warnings.append(str(error))
            continue

        for index, raw_record in enumerate(raw_records):
            if not isinstance(raw_record, dict):
                warnings.append(f"{path.name}[{index}]: expected an object")
                continue

            card_id = _record_card_id(raw_record)
            if card_id is None:
                warnings.append(f"{path.name}[{index}]: missing card id")
                continue

            card_type = raw_record.get("type", raw_record.get("cardType", ""))
            if normalize_card_id(card_type).replace(" ", "") == "heropower":
                continue

            key = normalize_card_id(card_id)
            if key in records:
                warnings.append(
                    f"Duplicate card id {card_id!r}; using the record from {path.name}"
                )
            records[key] = dict(raw_record)

    return records, warnings


def frame_filename_for_card(card: CollectionRecord | None) -> str | None:
    if card is None:
        return None

    card_type = card.get("type", card.get("cardType", ""))
    return frame_filename_for_type(card_type)


def frame_filename_for_type(card_type: object) -> str | None:
    normalized_type = "".join(
        character for character in str(card_type).casefold() if character.isalnum()
    )
    return FRAME_FILES.get(normalized_type)


def metadata_path(image_path: Path, meta_folder: Path = DEFAULT_METADATA_FOLDER) -> Path:
    return meta_folder / (image_path.stem + ".json")


def _stored_source_path(image_path: Path) -> str:
    try:
        return str(image_path.resolve().relative_to(REPO_ROOT.resolve()))
    except ValueError:
        return str(image_path.resolve())


def save_crop_metadata(
    image_path: Path,
    scale: float,
    offset_x: float,
    offset_y: float,
    meta_folder: Path = DEFAULT_METADATA_FOLDER,
    card: CollectionRecord | None = None,
) -> None:
    """Save crop parameters as JSON without altering the source artwork."""
    meta_folder.mkdir(parents=True, exist_ok=True)

    with Image.open(image_path) as image:
        width, height = image.size

    data: dict[str, object] = {
        "source_path": _stored_source_path(image_path),
        "source_name": image_path.name,
        "crop_box": list(visible_source_box(offset_x, offset_y, scale, width, height)),
        "scale": scale,
        "offset_x": offset_x,
        "offset_y": offset_y,
        "timestamp": datetime.now().isoformat(),
    }
    if card is not None:
        card_id = _record_card_id(card)
        if card_id:
            data["card_id"] = card_id
        card_type = card.get("type", card.get("cardType"))
        if card_type:
            data["card_type"] = card_type
        frame_file = frame_filename_for_card(card)
        if frame_file:
            data["frame_file"] = frame_file

    with metadata_path(image_path, meta_folder).open("w", encoding="utf-8") as file:
        json.dump(data, file, indent=2)


def load_crop_metadata(
    image_path: Path, meta_folder: Path = DEFAULT_METADATA_FOLDER
) -> dict[str, Any] | None:
    meta = metadata_path(image_path, meta_folder)
    if not meta.exists():
        return None
    try:
        with meta.open("r", encoding="utf-8") as file:
            value = json.load(file)
        return value if isinstance(value, dict) else None
    except (OSError, json.JSONDecodeError):
        return None


def has_prepared_metadata(
    image_path: Path, meta_folder: Path = DEFAULT_METADATA_FOLDER
) -> bool:
    return metadata_path(image_path, meta_folder).exists()


def image_size(image_path: Path) -> tuple[int, int] | None:
    """Read an image's dimensions without keeping the file open."""
    try:
        with Image.open(image_path) as image:
            return image.size
    except (OSError, ValueError):
        return None


def has_exact_artwork_size(image_path: Path) -> bool:
    """Return whether an input or output image is already 500x500."""
    return image_size(image_path) == (CROP_SIZE, CROP_SIZE)


def artwork_output_path(image_path: Path, output_folder: Path) -> Path:
    return output_folder / f"{image_path.stem}.jpg"


def artwork_output_candidates(image_path: Path, output_folder: Path) -> tuple[Path, ...]:
    """Return legacy and canonical output names for one source image."""
    candidates = (
        output_folder / image_path.name,
        artwork_output_path(image_path, output_folder),
    )
    return tuple(dict.fromkeys(candidates))


def has_fixed_output(image_path: Path, output_folder: Path) -> bool:
    """Return whether an exported candidate has the required 500x500 size."""
    return any(
        has_exact_artwork_size(candidate)
        for candidate in artwork_output_candidates(image_path, output_folder)
    )


def has_any_output(image_path: Path, output_folder: Path) -> bool:
    """Return whether any output file exists, regardless of its dimensions."""
    return any(
        candidate.exists()
        for candidate in artwork_output_candidates(image_path, output_folder)
    )


def has_exported_output(image_path: Path, output_folder: Path) -> bool:
    """Return whether an exported output is a valid 500x500 artwork."""
    return has_fixed_output(image_path, output_folder)


def has_fixed_artwork(image_path: Path, output_folder: Path) -> bool:
    """Return whether the source or its exported result is already 500x500."""
    return has_exact_artwork_size(image_path) or has_exported_output(
        image_path, output_folder
    )


def crop_box_from_metadata(
    metadata: dict[str, Any], width: int, height: int
) -> tuple[int, int, int, int]:
    """Resolve crop metadata against the current source dimensions.

    Older metadata can refer to a larger source file that has since been
    replaced by a 500x500 asset. In that case the stored ``crop_box`` is no
    longer authoritative. Reconstructing the box from the saved view scale
    and offset keeps the crop inside the current image and avoids Pillow's
    out-of-bounds black padding. The raw box remains a fallback for older
    metadata that predates scale/offset fields.
    """
    try:
        scale = float(metadata["scale"])
        offset_x = float(metadata["offset_x"])
        offset_y = float(metadata["offset_y"])
        if (
            math.isfinite(scale)
            and math.isfinite(offset_x)
            and math.isfinite(offset_y)
            and scale > 0
        ):
            scale = max(scale, cover_fit_scale(width, height))
            offset_x, offset_y = clamp_offset(
                offset_x, offset_y, scale, width, height
            )
            return visible_source_box(
                offset_x, offset_y, scale, width, height
            )
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        pass

    raw_box = metadata.get("crop_box")
    if isinstance(raw_box, (list, tuple)) and len(raw_box) == 4:
        try:
            return clamp_crop_box(
                tuple(int(value) for value in raw_box), width, height
            )
        except (TypeError, ValueError, OverflowError):
            pass
    raise ValueError("metadata has no usable crop coordinates")


class CropToolApp:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title(WINDOW_TITLE)
        self.root.geometry("1500x1000")
        self.root.minsize(1100, 780)

        self.source_folder = DEFAULT_SOURCE_FOLDER
        self.output_folder = DEFAULT_OUTPUT_FOLDER
        self.metadata_folder = DEFAULT_METADATA_FOLDER
        self.frame_folder = DEFAULT_FRAME_FOLDER
        self.collection_paths = sorted(DEFAULT_COLLECTION_FOLDER.glob("*.json"))
        self.card_records, self.collection_warnings = load_collection_records(
            self.collection_paths
        )

        self.current_image: Image.Image | None = None
        self.current_path: Path | None = None
        self.scale = 1.0
        self.offset_x = 0.0
        self.offset_y = 0.0
        self._drag_anchor: tuple[float, float, float, float] | None = None
        self._current_card_photo: ImageTk.PhotoImage | None = None
        self._thumbnails: dict[Path, ImageTk.PhotoImage | None] = {}
        self._frame_cache: dict[Path, Image.Image] = {}
        self._name_banner_cache: dict[Path, Image.Image] = {}
        self._is_dirty = False
        self._changed_paths: set[Path] = set()

        self.source_folder_var = tk.StringVar(value=str(self.source_folder))
        self.output_folder_var = tk.StringVar(value=str(self.output_folder))
        self.frame_folder_var = tk.StringVar(value=str(self.frame_folder))
        self.fallback_frame_var = tk.StringVar(value=FALLBACK_FRAME_TYPES[0])
        self.search_var = tk.StringVar()
        self.show_fixed_var = tk.BooleanVar(value=True)
        self.show_needs_fix_var = tk.BooleanVar(value=True)
        self.collections_summary_var = tk.StringVar()
        self.card_info_var = tk.StringVar(value="Select an artwork file to preview it.")
        self.status_var = tk.StringVar(value="Loading...")

        self.source_list = source_files(self.source_folder)
        self.total_files = len(self.source_list)
        self.visible_source_list: list[Path] = []

        self._init_ui()
        self._update_collection_summary()
        self._load_thumbnails()
        self._update_status_bar()

    def _init_ui(self) -> None:
        status_bar = ttk.Label(
            self.root, textvariable=self.status_var, relief=tk.SUNKEN, anchor="w"
        )
        status_bar.pack(side=tk.BOTTOM, fill=tk.X, padx=4, pady=2)

        config_frame = ttk.LabelFrame(self.root, text="Crop project")
        config_frame.pack(side=tk.TOP, fill=tk.X, padx=8, pady=(8, 4))
        config_frame.columnconfigure(1, weight=1)

        self._add_path_row(
            config_frame,
            0,
            "Input folder:",
            self.source_folder_var,
            self._browse_source_folder,
        )
        self._add_path_row(
            config_frame,
            1,
            "Output folder:",
            self.output_folder_var,
            self._browse_output_folder,
        )
        self._add_path_row(
            config_frame,
            2,
            "Frame folder:",
            self.frame_folder_var,
            self._browse_frame_folder,
        )

        ttk.Label(config_frame, text="Fallback frame:").grid(
            row=3, column=0, sticky="w", padx=(8, 6), pady=4
        )
        fallback_frame = ttk.Combobox(
            config_frame,
            textvariable=self.fallback_frame_var,
            values=FALLBACK_FRAME_TYPES,
            state="readonly",
            width=14,
        )
        fallback_frame.grid(row=3, column=1, sticky="w", padx=4, pady=4)
        fallback_frame.bind("<<ComboboxSelected>>", self._on_fallback_frame_changed)

        ttk.Label(config_frame, text="Collection JSONs:").grid(
            row=4, column=0, sticky="w", padx=(8, 6), pady=4
        )
        ttk.Label(
            config_frame,
            textvariable=self.collections_summary_var,
            anchor="w",
        ).grid(row=4, column=1, sticky="ew", padx=4, pady=4)
        ttk.Button(
            config_frame, text="Choose card JSONs...", command=self._choose_collections
        ).grid(row=4, column=2, padx=4, pady=4)

        main_frame = ttk.Frame(self.root)
        main_frame.pack(fill=tk.BOTH, expand=True, padx=8, pady=(4, 8))

        self.list_frame = ttk.LabelFrame(main_frame, text="Artwork files")
        self.list_frame.pack(side=tk.LEFT, fill=tk.Y, expand=False, padx=(0, 8))

        search_frame = ttk.Frame(self.list_frame)
        search_frame.pack(side=tk.TOP, fill=tk.X, padx=4, pady=(4, 0))
        ttk.Label(search_frame, text="Search:").pack(side=tk.LEFT, padx=(0, 4))
        search_entry = ttk.Entry(search_frame, textvariable=self.search_var)
        search_entry.pack(side=tk.LEFT, fill=tk.X, expand=True)
        ttk.Button(
            search_frame, text="Clear search", command=self._clear_search
        ).pack(side=tk.LEFT, padx=(4, 0))
        search_entry.bind("<KeyRelease>", self._on_search_changed)
        search_entry.bind("<Escape>", self._clear_search)
        self.search_entry = search_entry

        filter_frame = ttk.Frame(self.list_frame)
        filter_frame.pack(side=tk.TOP, fill=tk.X, padx=4, pady=(4, 0))
        ttk.Label(filter_frame, text="Show:").pack(side=tk.LEFT, padx=(0, 4))
        ttk.Checkbutton(
            filter_frame,
            text="Fixed (500x500)",
            variable=self.show_fixed_var,
            command=self._on_status_filter_changed,
        ).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Checkbutton(
            filter_frame,
            text="Needs fixing",
            variable=self.show_needs_fix_var,
            command=self._on_status_filter_changed,
        ).pack(side=tk.LEFT, padx=(0, 6))
        ttk.Button(
            filter_frame, text="Show all", command=self._show_all_statuses
        ).pack(side=tk.RIGHT)

        legend_frame = ttk.Frame(self.list_frame)
        legend_frame.pack(side=tk.TOP, fill=tk.X, padx=4, pady=(4, 0))
        for prefix, label, color in (
            (FIXED_PREFIX, "Fixed", FIXED_FG),
            (PREPARED_PREFIX, "Saved crop", PREPARED_FG),
            (NEEDS_FIX_PREFIX, "Needs fixing", NEEDS_FIX_FG),
            (UNMATCHED_PREFIX, "No card match", UNMATCHED_FG),
        ):
            ttk.Label(
                legend_frame,
                text=f"{prefix}{label}",
                foreground=color,
            ).pack(side=tk.LEFT, padx=(0, 7))

        self.tree = ttk.Treeview(
            self.list_frame, show="tree", selectmode="browse", height=24
        )
        self.tree.column("#0", width=340, minwidth=240, stretch=True)
        ttk.Style().configure("Treeview", rowheight=THUMBNAIL_SIZE + 8)
        self.tree.pack(side=tk.LEFT, fill=tk.Y, expand=True, padx=(4, 0), pady=4)

        scrollbar = ttk.Scrollbar(
            self.list_frame, orient=tk.VERTICAL, command=self.tree.yview
        )
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y, padx=(0, 4), pady=4)
        self.tree.configure(yscrollcommand=scrollbar.set)
        self.tree.bind("<<TreeviewSelect>>", self._on_list_select)

        right_frame = ttk.Frame(main_frame)
        right_frame.pack(side=tk.RIGHT, fill=tk.BOTH, expand=True)

        toolbar = ttk.Frame(right_frame)
        toolbar.pack(side=tk.TOP, fill=tk.X, pady=(0, 8))

        ttk.Button(toolbar, text="Save crop", command=self._on_save).pack(
            side=tk.LEFT, padx=4
        )
        ttk.Separator(toolbar, orient=tk.VERTICAL).pack(
            side=tk.LEFT, padx=8, fill=tk.Y
        )
        ttk.Button(
            toolbar, text="Export changed crops", command=self._on_export_all
        ).pack(side=tk.LEFT, padx=4)

        preview_area = ttk.Frame(right_frame)
        preview_area.pack(side=tk.TOP, fill=tk.BOTH, expand=True)

        card_panel = ttk.LabelFrame(
            preview_area, text="Card preview (drag to pan, mouse wheel to zoom)"
        )
        card_panel.pack(side=tk.TOP, anchor="n")
        self.card_canvas = tk.Canvas(
            card_panel,
            width=CARD_PREVIEW_SIZE[0],
            height=CARD_PREVIEW_SIZE[1],
            highlightthickness=0,
            bg=CANVAS_BG,
        )
        self.card_canvas.pack(padx=6, pady=6)
        self._card_canvas_image_id = self.card_canvas.create_image(
            0, 0, anchor="nw", image=None
        )
        ttk.Label(
            card_panel,
            textvariable=self.card_info_var,
            justify=tk.LEFT,
            wraplength=CARD_PREVIEW_SIZE[0] + 12,
        ).pack(fill=tk.X, padx=6, pady=(0, 6))

        self.card_canvas.bind("<MouseWheel>", self._on_mouse_wheel)
        self.card_canvas.bind("<ButtonPress-1>", self._on_drag_start)
        self.card_canvas.bind("<B1-Motion>", self._on_drag_motion)
        self.card_canvas.bind("<ButtonRelease-1>", self._on_drag_end)

        self.root.bind("<Control-s>", self._on_save)
        self.root.bind("<Control-S>", self._on_save)
        self.root.bind("<Control-f>", self._focus_search)
        self.root.bind("<Control-F>", self._focus_search)

    def _add_path_row(
        self,
        parent: ttk.LabelFrame,
        row: int,
        label: str,
        variable: tk.StringVar,
        browse_command: Any,
    ) -> None:
        ttk.Label(parent, text=label).grid(
            row=row, column=0, sticky="w", padx=(8, 6), pady=4
        )
        path_entry = ttk.Entry(parent, textvariable=variable)
        path_entry.grid(
            row=row, column=1, columnspan=2, sticky="ew", padx=4, pady=4
        )
        path_entry.bind("<Return>", self._on_folder_entry_commit)
        path_entry.bind("<FocusOut>", self._on_folder_entry_commit)
        ttk.Button(parent, text="Browse...", command=browse_command).grid(
            row=row, column=3, padx=(0, 8), pady=4
        )

    def _on_folder_entry_commit(self, _event: tk.Event | None = None) -> None:
        self._apply_configuration()

    def _browse_source_folder(self) -> None:
        selected = filedialog.askdirectory(
            title="Choose artwork input folder", initialdir=self.source_folder_var.get()
        )
        if selected:
            self.source_folder_var.set(selected)
            self._apply_configuration()

    def _browse_output_folder(self) -> None:
        selected = filedialog.askdirectory(
            title="Choose artwork output folder", initialdir=self.output_folder_var.get()
        )
        if selected:
            self.output_folder_var.set(selected)
            self._apply_configuration()

    def _browse_frame_folder(self) -> None:
        selected = filedialog.askdirectory(
            title="Choose card-frame asset folder", initialdir=self.frame_folder_var.get()
        )
        if selected:
            self.frame_folder_var.set(selected)
            self._apply_configuration()

    def _choose_collections(self) -> None:
        initial_dir = (
            str(self.collection_paths[0].parent)
            if self.collection_paths
            else str(DEFAULT_COLLECTION_FOLDER)
        )
        selected = filedialog.askopenfilenames(
            title="Choose collection JSON files",
            initialdir=initial_dir,
            filetypes=[("JSON files", "*.json"), ("All files", "*.*")],
        )
        if selected:
            self._set_collection_paths([Path(path) for path in selected])

    def _set_collection_paths(self, paths: list[Path]) -> None:
        records, warnings = load_collection_records(paths)
        self.collection_paths = sorted(paths, key=lambda path: path.name.casefold())
        self.card_records = records
        self.collection_warnings = warnings
        self._update_collection_summary()
        self._rebuild_file_tree()
        if self.current_path is not None:
            self._redraw_canvas()

        if warnings:
            messagebox.showwarning(
                "Collection JSON warnings",
                "\n".join(warnings[:12])
                + (f"\n...and {len(warnings) - 12} more." if len(warnings) > 12 else ""),
            )

    def _on_fallback_frame_changed(self, _event: tk.Event) -> None:
        if self.current_path is not None:
            self._redraw_canvas()

    def _focus_search(self, _event: tk.Event | None = None) -> str:
        self.search_entry.focus_set()
        self.search_entry.selection_range(0, tk.END)
        return "break"

    def _clear_search(self, _event: tk.Event | None = None) -> str:
        self.search_var.set("")
        self._rebuild_file_tree()
        self.search_entry.focus_set()
        return "break"

    def _on_search_changed(self, _event: tk.Event | None = None) -> None:
        self._rebuild_file_tree()

    def _on_status_filter_changed(self) -> None:
        self._rebuild_file_tree()

    def _show_all_statuses(self) -> None:
        self.show_fixed_var.set(True)
        self.show_needs_fix_var.set(True)
        self._rebuild_file_tree()

    def _update_collection_summary(self) -> None:
        if not self.collection_paths:
            self.collections_summary_var.set("No collection JSONs loaded")
            return
        summary = (
            f"{len(self.collection_paths)} file(s), {len(self.card_records)} card records"
        )
        if self.collection_warnings:
            summary += f", {len(self.collection_warnings)} warning(s)"
        self.collections_summary_var.set(summary)

    def _apply_configuration(self) -> None:
        source_text = self.source_folder_var.get().strip()
        output_text = self.output_folder_var.get().strip()
        frame_text = self.frame_folder_var.get().strip()
        if not source_text or not output_text or not frame_text:
            messagebox.showerror(
                "Invalid folders",
                "Input, output, and frame folders must all have a path.",
            )
            return

        new_source = Path(source_text).expanduser()
        new_output = Path(output_text).expanduser()
        new_frame = Path(frame_text).expanduser()
        if not new_source.is_dir():
            messagebox.showerror(
                "Input folder not found", f"The input folder does not exist:\n{new_source}"
            )
            return

        source_changed = new_source != self.source_folder
        output_changed = new_output != self.output_folder
        frame_changed = new_frame != self.frame_folder
        if source_changed or output_changed or frame_changed:
            self._save_current_if_dirty()

        self.output_folder = new_output
        self.frame_folder = new_frame
        if frame_changed:
            self._frame_cache.clear()
            self._name_banner_cache.clear()

        if source_changed:
            self.source_folder = new_source
            self._reload_source_files()
        elif output_changed:
            self._rebuild_file_tree()
        else:
            self._refresh_tree_states()
        if not source_changed and self.current_path is not None:
            self._redraw_canvas()
        self._update_status_bar()

    def _reload_source_files(self) -> None:
        self.source_list = source_files(self.source_folder)
        self.total_files = len(self.source_list)
        self._thumbnails.clear()
        self.current_image = None
        self.current_path = None
        self._current_card_photo = None
        self._is_dirty = False
        self.card_canvas.itemconfig(self._card_canvas_image_id, image=None)
        self.card_info_var.set("Select an artwork file to preview it.")
        self._rebuild_file_tree()

    def _filtered_source_files(self) -> list[Path]:
        query = normalize_match_text(self.search_var.get())
        visible: list[Path] = []
        for path in self.source_list:
            is_fixed = has_fixed_artwork(path, self.output_folder)
            if is_fixed and not self.show_fixed_var.get():
                continue
            if not is_fixed and not self.show_needs_fix_var.get():
                continue

            if not query:
                visible.append(path)
                continue

            card = self._card_record_for_path(path)
            searchable_values = [path.stem, display_name_from_stem(path.stem)]
            if card is not None:
                searchable_values.extend(
                    [
                        str(card.get("name", "")),
                        str(_record_card_id(card) or ""),
                    ]
                )
            if any(query in normalize_match_text(value) for value in searchable_values):
                visible.append(path)
        return visible

    def _rebuild_file_tree(self) -> None:
        if not hasattr(self, "tree"):
            return
        self._save_current_if_dirty()
        selected_path = self.current_path
        for item in self.tree.get_children():
            self.tree.delete(item)
        self._load_thumbnails()
        if selected_path is not None and self.tree.exists(str(selected_path)):
            self.tree.selection_set(str(selected_path))
            self.tree.see(str(selected_path))

    def _load_thumbnails(self) -> None:
        self.tree.tag_configure("fixed", foreground=FIXED_FG)
        self.tree.tag_configure("prepared", foreground=PREPARED_FG)
        self.tree.tag_configure("needs_fix", foreground=NEEDS_FIX_FG)
        self.tree.tag_configure("unmatched", foreground=UNMATCHED_FG)
        self.visible_source_list = self._filtered_source_files()

        for index, path in enumerate(self.visible_source_list):
            if path not in self._thumbnails:
                self._thumbnails[path] = make_thumbnail(path)
            self._update_tree_row(path, insert=True)

            if (index + 1) % 50 == 0:
                self.status_var.set(
                    f"Loaded thumbnails: {index + 1}/{len(self.visible_source_list)}"
                )
                self.root.update()
        title = f"Artwork files ({len(self.visible_source_list)}/{self.total_files})"
        self.list_frame.configure(text=title)

    def _status_for_path(self, path: Path) -> str:
        if has_fixed_artwork(path, self.output_folder):
            return "fixed"
        if has_prepared_metadata(path, self.metadata_folder):
            return "prepared"
        if self.card_records and self._card_record_for_path(path) is None:
            return "unmatched"
        return "needs_fix"

    def _card_record_for_path(self, path: Path) -> CollectionRecord | None:
        direct_match = self.card_records.get(normalize_card_id(path.stem))
        if direct_match is not None:
            return direct_match

        artwork_name = artwork_match_key(path.stem)
        if not artwork_name:
            return None
        return next(
            (
                card
                for card in self.card_records.values()
                if normalize_match_text(card.get("name", "")) == artwork_name
            ),
            None,
        )

    def _update_tree_row(self, path: Path, insert: bool = False) -> None:
        status = self._status_for_path(path)
        status_details = {
            "fixed": ("fixed", FIXED_PREFIX),
            "prepared": ("prepared", PREPARED_PREFIX),
            "unmatched": ("unmatched", UNMATCHED_PREFIX),
            "needs_fix": ("needs_fix", NEEDS_FIX_PREFIX),
        }
        tag, prefix = status_details[status]
        tags = (tag,)
        text = prefix + path.name

        iid = str(path)
        if insert:
            self.tree.insert(
                "",
                "end",
                iid=iid,
                text=text,
                image=self._thumbnails.get(path),
                tags=tags,
            )
        elif self.tree.exists(iid):
            self.tree.item(iid, tags=tags, text=text)

    def _refresh_tree_states(self) -> None:
        for path in self.visible_source_list:
            self._update_tree_row(path)

    def _on_list_select(self, _event: tk.Event) -> None:
        self._save_current_if_dirty()

        selection = self.tree.selection()
        if not selection:
            return
        self._load_image(Path(selection[0]))

    def _load_image(self, path: Path) -> None:
        try:
            with Image.open(path) as image:
                self.current_image = image.convert("RGB")
            self.current_path = path
            width, height = self.current_image.size

            meta = load_crop_metadata(path, self.metadata_folder)
            if meta is not None:
                try:
                    self.scale = max(float(meta["scale"]), cover_fit_scale(width, height))
                    self.offset_x = float(meta["offset_x"])
                    self.offset_y = float(meta["offset_y"])
                    self.offset_x, self.offset_y = clamp_offset(
                        self.offset_x, self.offset_y, self.scale, width, height
                    )
                except (KeyError, TypeError, ValueError):
                    self.scale = default_view_scale(width, height)
                    self.offset_x, self.offset_y = initial_offset(
                        width, height, self.scale
                    )
            else:
                self.scale = default_view_scale(width, height)
                self.offset_x, self.offset_y = initial_offset(width, height, self.scale)

            self._is_dirty = False
            self._redraw_canvas()
        except Exception as error:
            self.status_var.set(f"Error loading {path.name}: {error}")
            self.card_canvas.bell()

    def _on_mouse_wheel(self, event: tk.Event) -> None:
        if self.current_image is None or self.current_path is None:
            return
        factor = ZOOM_WHEEL_FACTOR ** (event.delta / 120)
        width, height = self.current_image.size
        anchor_x, anchor_y = self._preview_point_to_artwork(event.x, event.y)
        self.scale, self.offset_x, self.offset_y = zoom_at(
            self.scale,
            self.offset_x,
            self.offset_y,
            factor,
            anchor_x,
            anchor_y,
            width,
            height,
        )
        self._mark_dirty()
        self._redraw_canvas()

    def _on_drag_start(self, event: tk.Event) -> None:
        self._drag_anchor = (event.x, event.y, self.offset_x, self.offset_y)

    def _on_drag_end(self, _event: tk.Event) -> None:
        self._drag_anchor = None

    @staticmethod
    def _preview_point_to_artwork(x: float, y: float) -> tuple[float, float]:
        """Convert displayed card coordinates into the 500x500 art area."""
        card_x = x / CARD_PREVIEW_SCALE - ARTWORK_POSITION[0]
        card_y = y / CARD_PREVIEW_SCALE - ARTWORK_POSITION[1]
        return (
            min(float(CROP_SIZE), max(0.0, card_x)),
            min(float(CROP_SIZE), max(0.0, card_y)),
        )

    def _on_drag_motion(self, event: tk.Event) -> None:
        if self.current_image is None or self._drag_anchor is None:
            return
        start_x, start_y, start_ox, start_oy = self._drag_anchor
        new_ox = start_ox + (event.x - start_x) / CARD_PREVIEW_SCALE
        new_oy = start_oy + (event.y - start_y) / CARD_PREVIEW_SCALE
        width, height = self.current_image.size
        self.offset_x, self.offset_y = clamp_offset(
            new_ox, new_oy, self.scale, width, height
        )
        self._mark_dirty()
        self._redraw_canvas()

    @staticmethod
    def _path_key(path: Path) -> Path:
        return path.resolve()

    def _mark_dirty(self) -> None:
        self._is_dirty = True
        if self.current_path is not None:
            self._changed_paths.add(self._path_key(self.current_path))

    def _save_current_if_dirty(self) -> None:
        if self._is_dirty and self.current_path is not None:
            path = self.current_path
            self._save_metadata()
            self._mark_prepared(path)

    def _frame_for_path(
        self, path: Path
    ) -> tuple[Image.Image | None, str | None]:
        card = self._card_record_for_path(path)
        frame_note: str | None = None
        if card is None:
            frame_name = frame_filename_for_type(self.fallback_frame_var.get())
            frame_note = (
                "No matching collection record; "
                f"using fallback {frame_name or 'frame'}"
            )
        else:
            frame_name = frame_filename_for_card(card)
        if frame_name is None:
            card_type = card.get("type", "") if card is not None else ""
            frame_name = frame_filename_for_type(self.fallback_frame_var.get())
            frame_note = (
                f"Unsupported card type: {card_type}; "
                f"using fallback {frame_name or 'frame'}"
            )

        frame_path = self.frame_folder / frame_name
        if not frame_path.is_file():
            missing_note = f"Missing frame asset: {frame_path.name}"
            return None, f"{frame_note}; {missing_note}" if frame_note else missing_note

        cache_key = frame_path.resolve()
        cached = self._frame_cache.get(cache_key)
        if cached is not None:
            return cached, None

        try:
            with Image.open(frame_path) as image:
                frame = image.convert("RGBA").copy()
        except Exception as error:
            error_note = f"Error loading {frame_path.name}: {error}"
            return None, f"{frame_note}; {error_note}" if frame_note else error_note

        self._frame_cache[cache_key] = frame
        return frame, frame_note

    def _name_banner_for_preview(self) -> Image.Image | None:
        banner_path = self.frame_folder / NAME_BANNER_FILE
        if not banner_path.is_file():
            return None

        cache_key = banner_path.resolve()
        cached = self._name_banner_cache.get(cache_key)
        if cached is not None:
            return cached

        try:
            with Image.open(banner_path) as image:
                banner = image.convert("RGBA").copy()
        except Exception:
            return None

        self._name_banner_cache[cache_key] = banner
        return banner

    def _card_name_for_path(self, path: Path) -> str:
        card = self._card_record_for_path(path)
        if card is not None:
            name = card.get("name")
            if name:
                return str(name)
        return display_name_from_stem(path.stem)

    def _redraw_canvas(self) -> None:
        if self.current_image is None or self.current_path is None:
            return

        width, height = self.current_image.size
        crop_box = visible_source_box(
            self.offset_x, self.offset_y, self.scale, width, height
        )
        artwork = crop_to_artwork(self.current_image, crop_box)
        frame, frame_error = self._frame_for_path(self.current_path)
        card = self._card_record_for_path(self.current_path)
        card_preview = compose_card_preview(
            artwork,
            frame,
            self._name_banner_for_preview(),
            self._card_name_for_path(self.current_path),
        ).resize(
            CARD_PREVIEW_SIZE, Image.Resampling.LANCZOS
        )
        self._current_card_photo = ImageTk.PhotoImage(card_preview)
        self.card_canvas.itemconfig(
            self._card_canvas_image_id, image=self._current_card_photo
        )

        source_details = f"Source: {width}x{height}"
        if has_fixed_output(self.current_path, self.output_folder):
            output_details = "Output: 500x500"
        elif has_any_output(self.current_path, self.output_folder):
            output_details = "Output exists but is not 500x500"
        else:
            output_details = "Output: not exported"

        if card is None:
            self.card_info_var.set(
                f"No collection match for {self.current_path.stem}\n"
                f"{frame_error or 'Showing the fallback frame.'}\n"
                f"{source_details}  |  {output_details}"
            )
        else:
            card_name = card.get("name", self.current_path.stem)
            card_type = card.get("type", "Unknown type")
            if frame_error:
                self.card_info_var.set(
                    f"{card_name} - {card_type}\n{frame_error}\n"
                    f"{source_details}  |  {output_details}"
                )
            else:
                self.card_info_var.set(
                    f"{card_name} - {card_type}\n"
                    f"Frame: {frame_filename_for_card(card)}\n"
                    f"{source_details}  |  {output_details}"
                )
        self._update_status_bar()

    def _update_status_bar(self) -> None:
        fixed = sum(
            1 for path in self.source_list if has_fixed_artwork(path, self.output_folder)
        )
        exported = sum(
            1 for path in self.source_list if has_fixed_output(path, self.output_folder)
        )
        prepared = sum(
            1
            for path in self.source_list
            if has_prepared_metadata(path, self.metadata_folder)
        )
        changed = sum(
            1
            for path in self.source_list
            if self._path_key(path) in self._changed_paths
        )
        collection_text = f"Cards: {len(self.card_records)}"
        if self.current_path is None or self.current_image is None:
            self.status_var.set(
                f"Fixed: {fixed}/{self.total_files}  |  "
                f"Exported 500x500: {exported}/{self.total_files}  |  "
                f"Saved crops: {prepared}/{self.total_files}  |  "
                f"Changed now: {changed}/{self.total_files}  |  {collection_text}"
            )
            return

        width, height = self.current_image.size
        cover = cover_fit_scale(width, height)
        zoom_pct = round(self.scale / cover * 100)
        dirty_indicator = " *" if self._is_dirty else ""
        self.status_var.set(
            f"Fixed: {fixed}/{self.total_files}  |  "
            f"Exported 500x500: {exported}/{self.total_files}  |  "
            f"Saved crops: {prepared}/{self.total_files}  |  "
            f"Changed now: {changed}/{self.total_files}  |  {collection_text}  |  "
            f"{self.current_path.name}{dirty_indicator}  |  Zoom: {zoom_pct}%"
        )

    def _on_save(self, _event: tk.Event | None = None) -> None:
        """Save crop metadata for later editing."""
        if self.current_path is None or self.current_image is None:
            self.status_var.set("Load an image before saving.")
            self.card_canvas.bell()
            return

        try:
            self._save_metadata()
            self._mark_prepared(self.current_path)
            self._update_status_bar()
        except Exception as error:
            self.status_var.set(f"Error saving metadata: {error}")
            self.card_canvas.bell()

    def _save_metadata(self) -> None:
        if self.current_path is None or self.current_image is None:
            return
        save_crop_metadata(
            self.current_path,
            self.scale,
            self.offset_x,
            self.offset_y,
            self.metadata_folder,
            self._card_record_for_path(self.current_path),
        )
        self._is_dirty = False

    def _mark_prepared(self, path: Path) -> None:
        self._update_tree_row(path)

    def _on_export_all(self) -> None:
        """Export crops changed during the current application session."""
        try:
            self._save_current_if_dirty()
        except Exception as error:
            self.status_var.set(f"Error saving metadata before export: {error}")
            self.card_canvas.bell()
            return

        prepared_files = [
            path
            for path in self.source_list
            if self._path_key(path) in self._changed_paths
            and has_prepared_metadata(path, self.metadata_folder)
        ]
        if not prepared_files:
            self.status_var.set("No crops changed since the last export.")
            return

        try:
            if self.source_folder.resolve() == self.output_folder.resolve():
                self.status_var.set(
                    "Input and output folders must be different to avoid overwriting source artwork."
                )
                return
        except OSError:
            pass

        self.output_folder.mkdir(parents=True, exist_ok=True)
        exported_count = 0
        failed_files: list[str] = []
        successful_paths: set[Path] = set()

        for index, path in enumerate(prepared_files):
            try:
                meta = load_crop_metadata(path, self.metadata_folder)
                if not meta:
                    continue

                with Image.open(path) as source:
                    crop_box = crop_box_from_metadata(meta, *source.size)
                    artwork = crop_to_artwork(source.convert("RGB"), crop_box)
                    artwork.save(
                        artwork_output_path(path, self.output_folder),
                        format="JPEG",
                        quality=JPEG_QUALITY,
                    )
                exported_count += 1
                successful_paths.add(self._path_key(path))

                if (index + 1) % max(1, len(prepared_files) // 10) == 0:
                    self.status_var.set(
                        f"Exporting... {index + 1}/{len(prepared_files)}"
                    )
                    self.root.update()

            except Exception as error:
                print(f"Error exporting {path.name}: {error}")
                failed_files.append(path.name)
                continue

        message = (
            f"Exported {exported_count}/{len(prepared_files)} artwork files to "
            f"{self.output_folder}."
        )
        if failed_files:
            message += f" Failed: {len(failed_files)}. See the console for details."
        self._changed_paths.difference_update(successful_paths)
        self._rebuild_file_tree()
        self._update_status_bar()
        self.status_var.set(message)


def main() -> None:
    root = tk.Tk()
    CropToolApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
