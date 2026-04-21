import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Check, X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Button } from '@/components/ui/button'

interface DiagnosticCheck {
  name: string
  label: string
  passed: boolean
  duration_ms: number
  detail: string
}

interface NetworkDiagnostics {
  checks: DiagnosticCheck[]
  proxy_env: [string, string][]
  server_url: string
  app_version: string
  timestamp: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function buildReport(result: NetworkDiagnostics): string {
  const lines: string[] = []
  lines.push(`Labric Sync network diagnostic`)
  lines.push(`Time: ${result.timestamp}`)
  lines.push(`App version: ${result.app_version}`)
  lines.push(`Server: ${result.server_url}`)
  lines.push('')
  lines.push('Checks:')
  for (const c of result.checks) {
    lines.push(`  [${c.passed ? 'PASS' : 'FAIL'}] ${c.label} (${c.duration_ms}ms)`)
    lines.push(`         ${c.detail}`)
  }
  lines.push('')
  if (result.proxy_env.length > 0) {
    lines.push('Proxy environment:')
    for (const [k, v] of result.proxy_env) {
      lines.push(`  ${k}=${v}`)
    }
  } else {
    lines.push('Proxy environment: (none set)')
  }
  return lines.join('\n')
}

export function NetworkDiagnosticSheet({ open, onOpenChange }: Props) {
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<NetworkDiagnostics | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runDiagnostic = useCallback(async () => {
    setIsRunning(true)
    setError(null)
    try {
      const res = await invoke<NetworkDiagnostics>('run_network_diagnostics', {
        serverUrl: import.meta.env.VITE_SERVER_URL,
      })
      setResult(res)
    } catch (e) {
      setError(String(e))
    } finally {
      setIsRunning(false)
    }
  }, [])

  useEffect(() => {
    if (open && !result && !isRunning) {
      runDiagnostic()
    }
    if (!open) {
      setResult(null)
      setError(null)
    }
  }, [open, result, isRunning, runDiagnostic])

  const handleCopy = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(buildReport(result))
      toast.success('Diagnostic report copied')
    } catch {
      toast.error('Failed to copy report')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[540px] flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle className="font-title">Network Diagnostic</SheetTitle>
          <SheetDescription className="sr-only">
            Checks whether this device can reach the Labric platform
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <FieldGroup>
            <Field>
              <FieldContent>
                <FieldLabel>Connectivity checks</FieldLabel>
              </FieldContent>

              {isRunning && !result && (
                <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running checks…
                </div>
              )}

              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  Failed to run diagnostic: {error}
                </div>
              )}

              {result && (
                <ul className="flex flex-col gap-2">
                  {result.checks.map((c) => (
                    <li key={c.name} className="rounded-md border p-3">
                      <div className="flex items-center gap-2">
                        {c.passed ? (
                          <Check className="h-4 w-4 text-success flex-shrink-0" />
                        ) : (
                          <X className="h-4 w-4 text-destructive flex-shrink-0" />
                        )}
                        <span className="text-sm font-medium">{c.label}</span>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {c.duration_ms}ms
                        </span>
                      </div>
                      <p className="mt-1 break-words pl-6 text-xs text-muted-foreground">
                        {c.detail}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Field>

            {result && (
              <Field>
                <FieldContent>
                  <FieldLabel>Proxy environment</FieldLabel>
                </FieldContent>
                {result.proxy_env.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None set</p>
                ) : (
                  <ul className="text-sm text-muted-foreground space-y-0.5">
                    {result.proxy_env.map(([k, v]) => (
                      <li key={k} className="break-all">
                        {k}={v}
                      </li>
                    ))}
                  </ul>
                )}
              </Field>
            )}

            {result && (
              <Field>
                <FieldContent>
                  <FieldLabel>Environment</FieldLabel>
                </FieldContent>
                <div className="text-sm text-muted-foreground space-y-0.5">
                  <div>
                    Server: <span className="break-all">{result.server_url}</span>
                  </div>
                  <div>App version: {result.app_version}</div>
                </div>
              </Field>
            )}
          </FieldGroup>
        </div>

        <SheetFooter className="border-t flex-col gap-2 px-4 py-4">
          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              className="flex-1 rounded-full"
              onClick={handleCopy}
              disabled={!result}
            >
              Copy report
            </Button>
            <Button
              className="flex-1 rounded-full"
              onClick={runDiagnostic}
              disabled={isRunning}
            >
              Run again
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
