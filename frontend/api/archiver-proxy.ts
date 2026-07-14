import handler from '../../api/archiver-proxy.js'

// Keep this declaration local: Vercel's static analyzer does not follow a
// re-export when selecting the function runtime.
export const config = { runtime: 'edge' }

export default handler
