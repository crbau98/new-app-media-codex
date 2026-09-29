"""Media ingestion pipeline: URL classification, safe fetching, image and
video processing, hashing/dedupe and background jobs.

Every optional native dependency (ffmpeg, ffprobe, pillow-heif) is
feature-detected once and degrades to a clear "skipped" status; importing this
package never requires them.
"""
