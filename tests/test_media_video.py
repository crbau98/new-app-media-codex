"""Video pipeline logic with a mocked subprocess runner (no ffmpeg needed)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.media_pipeline import ffmpeg, video

TC = ffmpeg.Toolchain(ffmpeg="/usr/bin/ffmpeg", ffprobe="/usr/bin/ffprobe", version="6.0", encoders=frozenset({"libx264", "aac", "libwebp"}))
NO_TC = ffmpeg.Toolchain()

FFPROBE_H264 = {
    "streams": [
        {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080, "pix_fmt": "yuv420p", "avg_frame_rate": "30000/1001", "profile": "High"},
        {"codec_type": "audio", "codec_name": "aac"},
    ],
    "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "125.5", "bit_rate": "4500000", "size": "70000000"},
}
FFPROBE_HEVC_MKV = {
    "streams": [{"codec_type": "video", "codec_name": "hevc", "width": 3840, "height": 2160, "pix_fmt": "yuv420p10le"}, {"codec_type": "audio", "codec_name": "ac3"}],
    "format": {"format_name": "matroska,webm", "duration": "60"},
}
FFPROBE_ROTATED = {
    "streams": [{"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080, "pix_fmt": "yuv420p",
                 "side_data_list": [{"rotation": -90}]}],
    "format": {"format_name": "mov,mp4,m4a,3gp,3g2,mj2", "duration": "10"},
}


def test_parse_ffprobe_basic():
    m = video.parse_ffprobe(FFPROBE_H264)
    assert (m.width, m.height, m.aspect) == (1920, 1080, 1.7778)
    assert m.duration_seconds == 125.5 and m.has_audio and m.video_codec == "h264" and m.audio_codec == "aac"
    assert m.bitrate == 4_500_000 and m.fps == 29.97 and m.codec_label == "h264/aac"


def test_parse_ffprobe_rotation_swaps_dimensions():
    m = video.parse_ffprobe(FFPROBE_ROTATED)
    assert m.rotation == 90 and (m.width, m.height) == (1080, 1920) and not m.has_audio
    legacy = {"streams": [{"codec_type": "video", "codec_name": "h264", "width": 640, "height": 360, "tags": {"rotate": "270"}}], "format": {}}
    assert video.parse_ffprobe(legacy).width == 360


def test_parse_ffprobe_ignores_cover_art_stream():
    payload = {"streams": [{"codec_type": "video", "codec_name": "mjpeg", "width": 500, "height": 500, "disposition": {"attached_pic": 1}}], "format": {}}
    assert video.parse_ffprobe(payload).width is None


def test_plan_h264_mp4_is_playable_as_is():
    plan = video.plan_for(video.parse_ffprobe(FFPROBE_H264), faststart=True)
    assert plan.playable and plan.action == "none"


def test_plan_moov_at_end_needs_faststart():
    plan = video.plan_for(video.parse_ffprobe(FFPROBE_H264), faststart=False)
    assert plan.action == "faststart" and plan.playable and "moov_at_end" in plan.reasons


def test_plan_hevc_mkv_needs_transcode():
    plan = video.plan_for(video.parse_ffprobe(FFPROBE_HEVC_MKV), faststart=None)
    assert plan.action == "transcode" and not plan.playable
    assert any("hevc" in r for r in plan.reasons)


def test_plan_h264_in_mkv_only_remux():
    payload = json.loads(json.dumps(FFPROBE_H264))
    payload["format"]["format_name"] = "matroska,webm"
    assert video.plan_for(video.parse_ffprobe(payload), None).action == "remux"


def test_plan_10bit_h264_transcodes():
    payload = json.loads(json.dumps(FFPROBE_H264))
    payload["streams"][0]["pix_fmt"] = "yuv420p10le"
    assert video.plan_for(video.parse_ffprobe(payload), True).action == "transcode"


def test_plan_webm_vp9_ok():
    payload = {"streams": [{"codec_type": "video", "codec_name": "vp9", "width": 640, "height": 360}, {"codec_type": "audio", "codec_name": "opus"}],
               "format": {"format_name": "matroska,webm", "duration": "5"}}
    assert video.plan_for(video.parse_ffprobe(payload), None).action == "none"


def test_poster_timestamps_and_blank_detection():
    ts = video.poster_timestamps(100)
    assert ts[0] == 22.0 and all(0.5 <= t <= 99 for t in ts)
    assert video.poster_timestamps(None)[0] == 1.0
    assert video.poster_timestamps(2)[0] == 1.0
    assert video.is_blank_frame(bytes([0] * 2304))
    assert video.is_blank_frame(bytes([255] * 2304))
    assert video.is_blank_frame(bytes([128] * 2304))  # flat grey
    textured = bytes([(i * 37) % 200 + 20 for i in range(2304)])
    assert not video.is_blank_frame(textured)


def test_sprite_geometry():
    geo = video.sprite_geometry(300, 1920, 1080)
    assert geo == {"cols": 10, "rows": 10, "count": 100, "tileWidth": 160, "tileHeight": 90, "intervalSeconds": 3}
    short = video.sprite_geometry(25, 1080, 1920)
    assert short["count"] == 25 and short["rows"] == 3 and short["tileHeight"] % 2 == 0
    assert video.sprite_geometry(1, 100, 100) is None and video.sprite_geometry(None, 1, 1) is None


def test_hls_ladder_and_master():
    assert [h for h, _ in video.hls_ladder(720)] == [360, 540, 720]
    assert [h for h, _ in video.hls_ladder(None)] == [360, 540]
    assert [h for h, _ in video.hls_ladder(200)] == [360]
    master = video.build_master_playlist([(360, 800), (720, 2800)], 16 / 9)
    assert "RESOLUTION=640x360" in master and "RESOLUTION=1280x720" in master and "720p/index.m3u8" in master


def test_command_builders_are_safe_lists():
    cmd = video.cmd_transcode("ffmpeg", "/in file.mkv", "/out.mp4", has_audio=False)
    assert isinstance(cmd, list) and "/in file.mkv" in cmd and "-an" in cmd and "+faststart" in cmd
    assert "libx264" in cmd and "-pix_fmt" not in cmd and any("format=yuv420p" in c for c in cmd)
    assert video.cmd_faststart("ffmpeg", "a", "b")[-3:] == ["-movflags", "+faststart", "b"]


class FakeRunner:
    """Scripted ffmpeg/ffprobe replacement."""

    def __init__(self, probe=FFPROBE_H264, frames=None, fail=(), timeout=()):
        self.probe, self.frames, self.fail, self.timeout = probe, list(frames or []), set(fail), set(timeout)
        self.calls: list[list[str]] = []

    def __call__(self, cmd, timeout, **kw):
        self.calls.append(list(cmd))
        tool = os.path.basename(cmd[0])
        if tool == "ffprobe":
            if "probe" in self.fail:
                return ffmpeg.RunResult(1, b"", b"Invalid data")
            return ffmpeg.RunResult(0, json.dumps(self.probe).encode(), b"")
        if cmd[-1] == "-":  # gray frame probe
            if not self.frames:
                return ffmpeg.RunResult(1, b"", b"seek failed")
            return ffmpeg.RunResult(0, self.frames.pop(0), b"")
        kind = "poster" if "image2" in cmd and "-frames:v" in cmd and not any("tile=" in c for c in cmd) else None
        if any("tile=" in c for c in cmd):
            kind = "sprite"
        elif "-t" in cmd and "libx264" in cmd:
            kind = "preview"
        elif "copy" in cmd:
            kind = "remux"
        elif "libx264" in cmd:
            kind = "transcode"
        if kind in self.timeout:
            return ffmpeg.RunResult(-9, b"", b"", timed_out=True)
        if kind in self.fail:
            return ffmpeg.RunResult(1, b"", b"boom")
        Path(cmd[-1]).write_bytes(b"\x00" * 128)
        return ffmpeg.RunResult(0, b"", b"")


BLACK = bytes([0] * 2304)
GOOD = bytes([(i * 37) % 200 + 20 for i in range(2304)])


def test_probe_without_toolchain_skips_cleanly(tmp_path):
    step, meta = video.probe_video(str(tmp_path / "nope.mp4"), tc=NO_TC)
    assert step.status == "skipped" and step.reason == "ffprobe_unavailable" and meta is None


def test_probe_fallback_reads_mp4_without_ffprobe(tmp_path):
    from tests.test_media_pipeline_core import _mp4

    p = tmp_path / "v.mp4"
    p.write_bytes(_mp4(True))
    step, meta = video.probe_video(str(p), tc=NO_TC)
    assert step.ok and meta.source == "mp4probe" and meta.duration_seconds == 5.0 and meta.width == 640


def test_probe_error_and_timeout_are_failures_not_exceptions():
    step, meta = video.probe_video("x.mp4", tc=TC, runner=FakeRunner(fail={"probe"}))
    assert step.status == "failed" and meta is None
    step, _ = video.probe_video("x.mp4", tc=TC, runner=lambda *a, **k: ffmpeg.RunResult(-9, b"", b"", timed_out=True))
    assert step.reason == "ffprobe_timeout"


def test_poster_skips_black_frames_until_a_good_one(tmp_path):
    runner = FakeRunner(frames=[BLACK, BLACK, GOOD])
    meta = video.parse_ffprobe(FFPROBE_H264)
    out = tmp_path / "p.jpg"
    step = video.extract_poster("in.mp4", str(out), meta, tc=TC, runner=runner)
    assert step.ok and out.exists()
    assert step.data["timestamp"] == video.poster_timestamps(meta.duration_seconds)[2]
    assert [s["blank"] for s in step.data["samples"]] == [True, True, False]


def test_poster_falls_back_to_best_of_blank_frames(tmp_path):
    dim = bytes([10] * 1152 + [30] * 1152)
    runner = FakeRunner(frames=[BLACK, dim, BLACK, BLACK, BLACK])
    step = video.extract_poster("in.mp4", str(tmp_path / "p.jpg"), video.parse_ffprobe(FFPROBE_H264), tc=TC, runner=runner)
    assert step.ok and step.data["timestamp"] == video.poster_timestamps(125.5)[1]


def test_poster_all_frames_undecodable(tmp_path):
    step = video.extract_poster("in.mp4", str(tmp_path / "p.jpg"), None, tc=TC, runner=FakeRunner())
    assert step.status == "failed" and step.reason == "no_decodable_frame"


def test_steps_skip_without_ffmpeg(tmp_path):
    meta = video.parse_ffprobe(FFPROBE_H264)
    for fn in (video.extract_poster, video.make_sprite, video.make_preview):
        assert fn("in.mp4", str(tmp_path / "o"), meta, tc=NO_TC).status == "skipped"
    assert video.make_hls("in.mp4", str(tmp_path / "h"), meta, tc=NO_TC).status == "skipped"


def test_sprite_and_preview_ok_and_failure(tmp_path):
    meta = video.parse_ffprobe(FFPROBE_H264)
    r = FakeRunner()
    s = video.make_sprite("in.mp4", str(tmp_path / "s.jpg"), meta, tc=TC, runner=r)
    assert s.ok and s.data["grid"]["count"] == 63
    assert any("tile=10x7" in " ".join(c) for c in r.calls)
    p = video.make_preview("in.mp4", str(tmp_path / "p.mp4"), meta, tc=TC, runner=r)
    assert p.ok
    assert video.make_sprite("in.mp4", str(tmp_path / "s2.jpg"), meta, tc=TC, runner=FakeRunner(timeout={"sprite"})).reason == "timeout"
    assert video.make_sprite("in.mp4", str(tmp_path / "s3.jpg"), None, tc=TC, runner=r).reason == "duration_unknown"


def test_normalize_transcode_and_remux_fallback(tmp_path):
    meta = video.parse_ffprobe(FFPROBE_HEVC_MKV)
    plan = video.plan_for(meta, None)
    r = FakeRunner(probe=FFPROBE_HEVC_MKV)
    out = tmp_path / "n.mp4"
    s = video.normalize_for_browser("in.mkv", str(out), meta, plan, tc=TC, runner=r)
    assert s.ok and out.exists() and not Path(str(out) + ".part.mp4").exists()

    # remux failure falls back to a real transcode
    remux_meta = video.parse_ffprobe({**FFPROBE_H264, "format": {**FFPROBE_H264["format"], "format_name": "matroska,webm"}})
    r2 = FakeRunner(fail={"remux"})
    out2 = tmp_path / "n2.mp4"
    s2 = video.normalize_for_browser("in.mkv", str(out2), remux_meta, video.plan_for(remux_meta, None), tc=TC, runner=r2)
    assert s2.ok
    assert any("libx264" in c for c in r2.calls[-1:])

    none = video.normalize_for_browser("in.mp4", str(tmp_path / "x.mp4"), video.parse_ffprobe(FFPROBE_H264), video.plan_for(video.parse_ffprobe(FFPROBE_H264), True), tc=TC, runner=r)
    assert none.status == "skipped"


def test_transcode_failure_cleans_partial(tmp_path):
    meta = video.parse_ffprobe(FFPROBE_HEVC_MKV)
    out = tmp_path / "t.mp4"
    s = video.normalize_for_browser("in.mkv", str(out), meta, video.plan_for(meta, None), tc=TC, runner=FakeRunner(fail={"transcode"}))
    assert s.status == "failed" and not out.exists()


def test_hls_generates_master_for_successful_rungs(tmp_path):
    meta = video.parse_ffprobe(FFPROBE_H264)

    class R(FakeRunner):
        def __call__(self, cmd, timeout, **kw):
            self.calls.append(list(cmd))
            out = Path(cmd[-1])
            out.parent.mkdir(parents=True, exist_ok=True)
            if "360p" in cmd[-1] or "540p" in cmd[-1] or "720p" in cmd[-1] or "1080p" in cmd[-1]:
                if "540p" in cmd[-1]:
                    return ffmpeg.RunResult(1, b"", b"nope")
                out.write_text("#EXTM3U")
                return ffmpeg.RunResult(0, b"", b"")
            return ffmpeg.RunResult(1, b"", b"")

    step = video.make_hls("in.mp4", str(tmp_path / "hls"), meta, tc=TC, runner=R())
    assert step.ok and step.data["rungs"] == [360, 720, 1080]
    master = (tmp_path / "hls" / "master.m3u8").read_text()
    assert "540p" not in master and "1080p/index.m3u8" in master


def test_process_video_end_to_end_degrades_without_toolchain(tmp_path):
    from tests.test_media_pipeline_core import _mp4

    src = tmp_path / "v.mp4"
    src.write_bytes(_mp4(False))
    res = video.process_video(str(src), str(tmp_path / "out"), "vid", tc=NO_TC)
    assert res.faststart is False
    assert res.meta and res.meta.source == "mp4probe"
    statuses = {s.name: s.status for s in res.steps}
    assert statuses == {"probe": "ok", "poster": "skipped", "sprite": "skipped", "preview": "skipped"}
    assert res.files == {}


def test_process_video_full_with_mock(tmp_path):
    src = tmp_path / "v.mp4"
    src.write_bytes(b"x")
    seen = []
    res = video.process_video(
        str(src), str(tmp_path / "o"), "v", do_normalize=True, do_hls=False,
        tc=TC, runner=FakeRunner(frames=[GOOD]), on_step=lambda s: seen.append(s.name),
    )
    assert seen[:2] == ["probe", "poster"]
    assert set(res.files) >= {"poster", "sprite", "preview"}
    assert res.sprite_grid["count"] == 63
    d = res.to_dict()
    assert d["meta"]["width"] == 1920 and any(s["name"] == "sprite" for s in d["steps"])


def test_run_wrapper_handles_missing_binary_and_timeout():
    res = ffmpeg.run(["/definitely/not/a/binary"], 1)
    assert res.returncode == 127 and not res.ok
    import sys

    slow = ffmpeg.run([sys.executable, "-c", "import time; time.sleep(5)"], 0.3)
    assert slow.timed_out and not slow.ok


def test_toolchain_detection_is_cached_and_tolerates_absence(monkeypatch):
    ffmpeg.reset_toolchain_cache()
    monkeypatch.setattr(ffmpeg.shutil, "which", lambda name: None)
    monkeypatch.delenv("FFMPEG_PATH", raising=False)
    monkeypatch.delenv("FFPROBE_PATH", raising=False)
    tc = ffmpeg.toolchain(refresh=True)
    assert not tc.ffmpeg and not tc.ffprobe and tc.describe()["ffmpeg"] is False
    assert ffmpeg.toolchain() is tc
    ffmpeg.reset_toolchain_cache()
