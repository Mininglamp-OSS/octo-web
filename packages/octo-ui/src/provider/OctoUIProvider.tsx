import type { ReactElement, ReactNode } from 'react'

export interface OctoUIProviderProps {
  children?: ReactNode
}

export function OctoUIProvider({ children }: OctoUIProviderProps): ReactElement {
  return <>{children}</>
}
