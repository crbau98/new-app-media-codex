import { useCallback, useEffect, useState } from 'react'
import {
  addToCollection,
  COLLECTIONS_EVENT,
  createCollection,
  loadCollections,
  persistCollections,
  removeFromCollection,
  renameCollection,
  upsertCollection,
  type MediaCollection,
} from '@/lib/collections'

/**
 * LocalStorage-backed collections with cross-surface sync via a window event.
 * Everything stays on-device; the store is the single source of truth.
 */
export function useCollections() {
  const [collections, setCollections] = useState<MediaCollection[]>(() => loadCollections())

  useEffect(() => {
    const refresh = () => setCollections(loadCollections())
    window.addEventListener(COLLECTIONS_EVENT, refresh)
    return () => window.removeEventListener(COLLECTIONS_EVENT, refresh)
  }, [])

  const create = useCallback((name: string): MediaCollection => {
    const collection = createCollection(name)
    persistCollections([collection, ...loadCollections()])
    return collection
  }, [])

  const rename = useCallback((id: string, name: string) => {
    const current = loadCollections()
    const target = current.find((entry) => entry.id === id)
    if (!target) return
    persistCollections(upsertCollection(current, renameCollection(target, name)))
  }, [])

  const remove = useCallback((id: string) => {
    persistCollections(loadCollections().filter((entry) => entry.id !== id))
  }, [])

  const addItem = useCallback((id: string, itemId: string) => {
    const current = loadCollections()
    const target = current.find((entry) => entry.id === id)
    if (!target) return
    persistCollections(upsertCollection(current, addToCollection(target, itemId)))
  }, [])

  const removeItem = useCallback((id: string, itemId: string) => {
    const current = loadCollections()
    const target = current.find((entry) => entry.id === id)
    if (!target) return
    persistCollections(upsertCollection(current, removeFromCollection(target, itemId)))
  }, [])

  return { collections, create, rename, remove, addItem, removeItem }
}
