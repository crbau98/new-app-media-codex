import BrandMark from '@/components/chrome/BrandMark'

export default function Footer() {
  return (
    <footer className="pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-6 md:pb-10">
      <div className="hairline-gold-x mx-auto max-w-[1680px]" aria-hidden="true" />
      <div className="mx-auto flex max-w-[1680px] flex-col items-start gap-4 px-4 pt-8 md:flex-row md:items-center md:justify-between md:px-10">
        <BrandMark size={22} wordmark animated={false} className="opacity-90" />
        <p className="font-mono text-[10px] uppercase leading-5 tracking-[0.14em] text-ink-3">
          Codex — after-hours cinema archive · 18+ · all media source-attributed
        </p>
      </div>
    </footer>
  )
}
