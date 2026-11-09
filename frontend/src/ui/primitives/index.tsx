import { Dialog as D, Popover as P, ScrollArea as SA, Select as S, Tabs as T, ToggleGroup, Tooltip as TT } from 'radix-ui'
import { Check, ChevronDown, X } from 'lucide-react'
import { animate, useReducedMotion } from 'motion/react'
import { forwardRef, useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'

export const cn = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(' ')

type ButtonVariant = 'primary' | 'ghost' | 'quiet'
const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-md text-[13px] font-medium transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none select-none'
const buttonVariant: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-bg hover:bg-white h-9 px-4',
  ghost: 'border border-hairline-2 text-ink hover:bg-raised h-9 px-3.5',
  quiet: 'text-ink-2 hover:text-ink hover:bg-raised h-8 px-2.5',
}

export const Button = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'> & { variant?: ButtonVariant }>(
  function Button({ variant = 'ghost', className, ...props }, ref) {
    return <button ref={ref} className={cn(buttonBase, buttonVariant[variant], className)} {...props} />
  },
)

export const IconButton = forwardRef<HTMLButtonElement, ComponentPropsWithoutRef<'button'> & { label: string }>(
  function IconButton({ label, className, ...props }, ref) {
    return (
      <button
        ref={ref}
        aria-label={label}
        className={cn(
          'inline-flex size-7 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-raised hover:text-ink',
          className,
        )}
        {...props}
      />
    )
  },
)

export function Segmented<V extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: V | null
  onChange: (v: V) => void
  options: readonly { value: V; label: ReactNode }[]
  label: string
  size?: 'sm' | 'md'
}) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value ?? ''}
      onValueChange={(v) => v && onChange(v as V)}
      className="inline-flex rounded-md border border-hairline bg-sunken p-0.5"
    >
      {options.map((o) => (
        <ToggleGroup.Item
          key={o.value}
          value={o.value}
          className={cn(
            'num rounded-[5px] text-ink-3 transition-colors hover:text-ink data-[state=on]:bg-raised data-[state=on]:text-ink data-[state=on]:shadow-[inset_0_0_0_1px_var(--color-hairline-2)]',
            size === 'sm' ? 'h-6 px-2 text-[11px]' : 'h-7 px-2.5 text-[12px]',
          )}
        >
          {o.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <TT.Root>
      <TT.Trigger asChild>{children}</TT.Trigger>
      <TT.Portal>
        <TT.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-md border border-hairline-2 bg-raised px-2.5 py-1.5 text-[12px] text-ink-2 shadow-xl"
        >
          {content}
        </TT.Content>
      </TT.Portal>
    </TT.Root>
  )
}

export const TooltipProvider = TT.Provider

export function Popover({ trigger, children, align = 'end', className }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'center' | 'end'; className?: string }) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          align={align}
          sideOffset={8}
          collisionPadding={16}
          className={cn(
            'z-50 w-[340px] rounded-lg border border-hairline-2 bg-raised p-4 text-[13px] leading-relaxed text-ink-2 shadow-2xl shadow-black/60 outline-none data-[state=open]:animate-in',
            className,
          )}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  trigger,
}: {
  open?: boolean
  onOpenChange?: (o: boolean) => void
  title: string
  description?: string
  children: ReactNode
  trigger?: ReactNode
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <D.Trigger asChild>{trigger}</D.Trigger>}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px]" />
        <D.Content className="fixed top-1/2 left-1/2 z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-hairline-2 bg-surface p-6 shadow-2xl outline-none">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="display text-2xl text-ink">{title}</D.Title>
              {description && <D.Description className="mt-1 text-[13px] text-ink-2">{description}</D.Description>}
            </div>
            <D.Close asChild>
              <IconButton label="Close">
                <X size={16} />
              </IconButton>
            </D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

export function Tabs<V extends string>({
  value,
  onChange,
  tabs,
  label,
}: {
  value: V
  onChange: (v: V) => void
  tabs: readonly { value: V; label: ReactNode }[]
  label: string
}) {
  return (
    <T.Root value={value} onValueChange={(v) => onChange(v as V)}>
      <T.List aria-label={label} className="flex gap-4 border-b border-hairline">
        {tabs.map((t) => (
          <T.Trigger
            key={t.value}
            value={t.value}
            className="-mb-px border-b border-transparent pb-2 text-[13px] text-ink-3 transition-colors hover:text-ink data-[state=active]:border-ink data-[state=active]:text-ink"
          >
            {t.label}
          </T.Trigger>
        ))}
      </T.List>
    </T.Root>
  )
}

export function Select<V extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: V
  onChange: (v: V) => void
  options: readonly { value: V; label: string; hint?: string }[]
  label: string
}) {
  return (
    <S.Root value={value} onValueChange={(v) => onChange(v as V)}>
      <S.Trigger
        aria-label={label}
        className="inline-flex h-8 min-w-44 items-center justify-between gap-3 rounded-md border border-hairline-2 bg-sunken px-3 text-[12.5px] text-ink hover:border-ink-4"
      >
        <S.Value />
        <S.Icon>
          <ChevronDown size={14} className="text-ink-3" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content position="popper" sideOffset={6} className="z-50 min-w-[var(--radix-select-trigger-width)] rounded-md border border-hairline-2 bg-raised p-1 shadow-2xl">
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex cursor-default items-center justify-between gap-6 rounded-[5px] py-1.5 pr-2 pl-7 text-[12.5px] text-ink-2 outline-none data-[highlighted]:bg-white/5 data-[highlighted]:text-ink"
              >
                <S.ItemIndicator className="absolute left-2">
                  <Check size={13} strokeWidth={2.5} />
                </S.ItemIndicator>
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint && <span className="num text-[11px] text-ink-3">{o.hint}</span>}
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  )
}

export function ScrollArea({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <SA.Root className={cn('overflow-hidden', className)} type="hover">
      <SA.Viewport className="size-full">{children}</SA.Viewport>
      <SA.Scrollbar orientation="vertical" className="flex w-1.5 touch-none p-px select-none">
        <SA.Thumb className="relative flex-1 rounded-full bg-white/10" />
      </SA.Scrollbar>
    </SA.Root>
  )
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'bad' | 'live' }) {
  const tones = {
    neutral: 'text-ink-2 border-hairline-2',
    good: 'text-good border-good/30',
    bad: 'text-bad border-bad/30',
    live: 'text-sun border-sun/30',
  }
  return <span className={cn('num inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[10.5px] tracking-wide uppercase', tones[tone])}>{children}</span>
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-white/[0.035]', className)} />
}

export function EmptyState({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {icon && <div className="mb-1 text-ink-4">{icon}</div>}
      <div className="display text-lg text-ink-2 italic">{title}</div>
      {children && <div className="max-w-sm text-[13px] text-ink-3">{children}</div>}
    </div>
  )
}

/** A number that eases to its new value; formatting stays with the caller. */
export function Ticker({ value, format }: { value: number | null; format: (v: number | null) => string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const prev = useRef<number | null>(null)
  const reduced = useReducedMotion()
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const from = prev.current
    prev.current = value
    if (value == null || from == null || reduced || from === value) {
      el.textContent = format(value)
      return
    }
    const c = animate(from, value, { duration: 0.6, ease: [0.22, 1, 0.36, 1], onUpdate: (v) => (el.textContent = format(v)) })
    return () => c.stop()
  }, [value, format, reduced])
  return <span ref={ref}>{format(value)}</span>
}
