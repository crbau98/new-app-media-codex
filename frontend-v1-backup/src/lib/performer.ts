import type { Performer } from "./api"

const REMOTE_AVATAR_RE = /^(https?:\/\/|\/api\/screenshots\/proxy-media\?url=)/i
const LEGACY_CACHE_RE = /^\/cached-/i

export function isRemoteRenderableUrl(url: string | null | undefined): boolean {
  const normalized = (url ?? "").trim()
  return Boolean(normalized) && REMOTE_AVATAR_RE.test(normalized) && !LEGACY_CACHE_RE.test(normalized)
}

export function getPerformerAvatarSrc(
  performer: Pick<Performer, "avatar_url" | "avatar_local"> | null | undefined,
): string {
  const remoteAvatar = performer?.avatar_url?.trim() ?? ""
  if (isRemoteRenderableUrl(remoteAvatar)) return remoteAvatar

  const localAvatar = performer?.avatar_local?.trim() ?? ""
  if (isRemoteRenderableUrl(localAvatar)) return localAvatar

  return ""
}

export function getPerformerDisplayName(
  performer: Pick<Performer, "display_name" | "username">,
): string {
  return performer.display_name?.trim() || performer.username
}

export function getPerformerMeta(
  performer: Pick<Performer, "platform" | "username" | "display_name">,
): string {
  const label = getPerformerDisplayName(performer)
  return `${performer.platform}${performer.username !== label ? ` · @${performer.username}` : ""}`
}
