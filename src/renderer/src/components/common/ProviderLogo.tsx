import { Settings2 } from 'lucide-react'
import type { ManagedProviderKey } from '@/lib/providers'

// Brand icon assets for the managed providers
const MANAGED_BRAND_ICONS: Record<string, string> = {
  spark: new URL('../../assets/providers/spark.svg', import.meta.url).href,
  anthropic: new URL('../../assets/providers/anthropic.svg', import.meta.url).href,
  openai: new URL('../../assets/providers/openai.svg', import.meta.url).href,
  gemini: new URL('../../assets/providers/gemini.svg', import.meta.url).href,
  qwen: new URL('../../assets/providers/qwen.svg', import.meta.url).href,
  minimax: new URL('../../assets/providers/minimax.svg', import.meta.url).href,
  glm: new URL('../../assets/providers/glm.svg', import.meta.url).href,
  kimi: new URL('../../assets/providers/kimi.svg', import.meta.url).href,
  deepseek: new URL('../../assets/providers/deepseek.svg', import.meta.url).href,
}

const PROVIDER_TO_BRAND: Record<ManagedProviderKey, string> = {
  xunfei: 'spark',
  anthropic: 'anthropic',
  openai: 'openai',
  'gpt-image': 'openai',
  google: 'gemini',
  qwen: 'qwen',
  minimax: 'minimax',
  zhipu: 'glm',
  moonshot: 'kimi',
  doubao: 'custom',
  deepseek: 'deepseek',
  custom: 'custom',
}

function BrandIcon({ brand, size }: { brand: string; size: number }) {
  if (brand === 'custom') {
    return <Settings2 size={size} color="#475569" />
  }

  const iconUrl = MANAGED_BRAND_ICONS[brand]
  if (iconUrl) {
    return <img src={iconUrl} alt={brand} width={size} height={size} style={{ display: 'block' }} />
  }

  // Generic sparkle fallback
  return (
    <svg width={size} height={size} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#FFFFFF">
      <path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z" />
    </svg>
  )
}

export function ProviderLogo({ provider, size = 28 }: { provider: ManagedProviderKey; size?: number }) {
  const brand = PROVIDER_TO_BRAND[provider]
  return <BrandIcon brand={brand} size={size} />
}
