import type { ActiveView } from "../store"

type ModuleMap = Record<string, () => Promise<unknown>>

const loaders: ModuleMap = {
  overview: () => import("../features/images/MediaPage"),
  items: () => import("../features/images/MediaPage"),
  images: () => import("../features/images/MediaPage"),
  hypotheses: () => import("../features/images/MediaPage"),
  graph: () => import("../features/images/MediaPage"),
  performers: () => import("../features/performers/PerformersPage"),
  settings: () => import("../features/settings/SettingsPage"),
  profile: () => import("../features/profile/ProfilePage"),
}

const cache = new Map<string, Promise<unknown>>()

export function loadViewModule(view: string): Promise<unknown> {
  const loader = loaders[view]
  if (!loader) return loaders.images!()
  let promise = cache.get(view)
  if (!promise) {
    promise = loader()
    cache.set(view, promise)
  }
  return promise
}

export function prefetchViewModule(view: ActiveView): void {
  if (cache.has(view)) return
  const loader = loaders[view]
  if (loader) {
    cache.set(view, loader())
  }
}
