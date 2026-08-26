import { createContext } from 'react'

export interface DropdownContextValue {
  closeOnSelect: boolean
  close: () => void
}

export const DropdownContext = createContext<DropdownContextValue>({
  closeOnSelect: true,
  close: () => undefined,
})
