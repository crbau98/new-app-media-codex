"""Image normalisation, privacy stripping, hashing and clustering."""

from __future__ import annotations

import base64
import io

import pytest
from PIL import Image

from app.media_pipeline import hashing, images


def _gradient(w=320, h=200, flip=False) -> Image.Image:
    img = Image.new("RGB", (w, h))
    px = img.load()
    for x in range(w):
        for y in range(h):
            v = int(255 * (x / w))
            px[x, y] = (v, 120, 255 - v) if not flip else (255 - v, 120, v)
    return img


def _jpeg_with_exif(tmp_path, orientation=6, gps=True):
    img = _gradient(300, 200)
    exif = Image.Exif()
    exif[0x0112] = orientation
    exif[0x010F] = "SecretCameraMaker"
    exif[0x0132] = "2020:01:01 10:00:00"
    if gps:
        gps_ifd = exif.get_ifd(0x8825)
        gps_ifd[1] = "N"
        gps_ifd[2] = (37.0, 46.0, 30.0)
        gps_ifd[3] = "W"
        gps_ifd[4] = (122.0, 25.0, 10.0)
    p = tmp_path / "photo.jpg"
    img.save(p, "JPEG", exif=exif, quality=90, comment=b"private comment")
    return p


def test_exif_and_gps_stripped_and_orientation_applied(tmp_path):
    src = _jpeg_with_exif(tmp_path)
    # sanity: source really carries the private data
    assert Image.open(src).getexif().get(0x010F) == "SecretCameraMaker"
    res = images.process_image(src, tmp_path / "out", "abc")
    assert res.had_gps and res.exif_stripped and res.orientation_applied
    # orientation 6 rotates 300x200 -> 200x300
    assert (res.width, res.height) == (200, 300)
    for role, name in res.files.items():
        raw = (tmp_path / "out" / name).read_bytes()
        assert b"SecretCameraMaker" not in raw, role
        assert b"private comment" not in raw, role
        assert b"Exif" not in raw[:64], role
        with Image.open(tmp_path / "out" / name) as opened:
            assert len(opened.getexif()) == 0, role
            assert "exif" not in opened.info and "comment" not in opened.info and "icc_profile" not in opened.info, role


def test_outputs_thumb_variants_lqip_color_hashes(tmp_path):
    p = tmp_path / "a.png"
    _gradient(1200, 800).save(p)
    res = images.process_image(p, tmp_path / "o", "x", thumb_dimension=300)
    assert res.mime_type == "image/jpeg" and res.aspect == 1.5
    assert {"full", "thumb"} <= set(res.files)
    with Image.open(tmp_path / "o" / res.files["thumb"]) as t:
        assert max(t.size) <= 300
    assert res.dominant_color.startswith("#") and len(res.dominant_color) == 7
    assert res.lqip.startswith("data:image/") and len(res.lqip) < 1500
    payload = base64.b64decode(res.lqip.split(",", 1)[1])
    assert Image.open(io.BytesIO(payload)).width <= 20
    assert len(res.phash) == 16 and len(res.dhash) == 16 and len(res.sha256) == 64


def test_alpha_png_stays_png(tmp_path):
    p = tmp_path / "t.png"
    img = Image.new("RGBA", (50, 50), (255, 0, 0, 0))
    img.paste((0, 255, 0, 255), (10, 10, 30, 30))
    img.save(p)
    res = images.process_image(p, tmp_path / "o", "t")
    assert res.mime_type == "image/png" and res.files["full"].endswith(".png")


def test_oversized_image_downscaled(tmp_path):
    p = tmp_path / "big.png"
    Image.new("RGB", (5000, 100), (1, 2, 3)).save(p)
    res = images.process_image(p, tmp_path / "o", "b", max_dimension=1000)
    assert res.width == 1000


def test_animated_gif_becomes_animated_webp_with_poster(tmp_path):
    frames = [Image.new("RGB", (40, 40), c) for c in ((255, 0, 0), (0, 255, 0), (0, 0, 255))]
    p = tmp_path / "a.gif"
    frames[0].save(p, "GIF", save_all=True, append_images=frames[1:], duration=80, loop=0)
    res = images.process_image(p, tmp_path / "o", "anim")
    assert res.animated and res.frames == 3
    assert "poster" in res.files and "thumb" in res.files
    if images.webp_supported():
        with Image.open(tmp_path / "o" / res.files["full"]) as out:
            assert getattr(out, "n_frames", 1) == 3


def test_garbage_and_html_rejected(tmp_path):
    p = tmp_path / "x.jpg"
    p.write_bytes(b"<html>not an image</html>")
    with pytest.raises(images.ImageError) as err:
        images.process_image(p, tmp_path / "o", "x")
    assert err.value.code == "invalid_image"


def test_decompression_bomb_rejected(tmp_path, monkeypatch):
    p = tmp_path / "b.png"
    Image.new("RGB", (400, 400)).save(p)
    monkeypatch.setattr(Image, "MAX_IMAGE_PIXELS", 1000)
    with pytest.raises(images.ImageError) as err:
        images.process_image(p, tmp_path / "o", "b")
    assert err.value.code == "image_too_large"


def test_heic_degrades_without_plugin(tmp_path):
    # Not a real HEIC: we only assert the optional-dependency probe never raises.
    assert isinstance(images.heif_supported(), bool)


def test_phash_stable_across_recompression_and_resize(tmp_path):
    base = _gradient(400, 300)
    a, b = tmp_path / "a.jpg", tmp_path / "b.jpg"
    base.save(a, quality=95)
    base.resize((200, 150)).save(b, quality=40)
    ha = hashing.perceptual_hashes(Image.open(a))[0]
    hb = hashing.perceptual_hashes(Image.open(b))[0]
    assert hashing.hamming_hex(ha, hb) <= hashing.DEFAULT_PHASH_THRESHOLD
    other = hashing.perceptual_hashes(_gradient(400, 300, flip=True).transpose(Image.Transpose.FLIP_TOP_BOTTOM).rotate(90, expand=True))[0]
    assert hashing.hamming_hex(ha, other) > 0


def test_hamming_and_clustering():
    assert hashing.hamming_hex("ff", "00") == 8
    assert hashing.hamming_hex("ff", "0000") is None
    assert hashing.hamming_hex(None, "ff") is None
    items = [(1, "0000000000000000"), (2, "0000000000000003"), (3, "ffffffffffffffff"), (4, None), (5, "0000000000000007")]
    clusters = hashing.cluster_hashes(items, threshold=2)
    assert [sorted(c) for c in clusters] == [[1, 2, 5]]  # 5 links via 2 (single linkage)
    near = hashing.find_near_duplicates("0000000000000000", items, threshold=2)
    assert [i for i, _d in near] == [1, 2]


def test_sha256_file(tmp_path):
    p = tmp_path / "f"
    p.write_bytes(b"abc")
    assert hashing.sha256_file(p) == hashing.sha256_bytes(b"abc")
