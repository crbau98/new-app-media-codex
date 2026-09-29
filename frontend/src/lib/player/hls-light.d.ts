/** hls.js ships the light build without its own type entry; reuse the full typings. */
declare module 'hls.js/light' {
  import Hls from 'hls.js'
  export * from 'hls.js'
  export default Hls
}
