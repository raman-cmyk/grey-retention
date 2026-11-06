import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { controlClass } from './control'

export const TextField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function TextField({ className, ...props }, ref) {
  return <input ref={ref} className={cn(controlClass, className)} {...props} />
})
