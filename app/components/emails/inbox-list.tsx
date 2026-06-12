"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Mail, RefreshCw, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/components/ui/use-toast"
import { useThrottle } from "@/hooks/use-throttle"

interface Message {
  id: string
  emailId: string
  emailAddress: string
  from_address?: string
  to_address?: string
  subject: string
  content: string
  html?: string
  received_at?: number
  sent_at?: number
}

interface InboxListProps {
  onMessageSelect: (message: Message) => void
  selectedMessageId?: string | null
}

interface InboxResponse {
  messages: Message[]
  nextCursor: string | null
  total: number
}

export function InboxList({ onMessageSelect, selectedMessageId }: InboxListProps) {
  const { data: session } = useSession()
  const t = useTranslations("emails.inbox")
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("")
  const { toast: _toast } = useToast()

  // 防抖搜索：当用户停止输入300ms后才执行搜索
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const hasSearchQuery = debouncedSearchQuery.trim().length > 0

  const fetchMessages = async (cursor?: string) => {
    try {
      const url = new URL("/api/inbox", window.location.origin)
      if (cursor) {
        url.searchParams.set('cursor', cursor)
      }
      // 添加搜索参数
      if (debouncedSearchQuery.trim()) {
        url.searchParams.set('search', debouncedSearchQuery.trim())
      }
      const response = await fetch(url)
      const data = await response.json() as InboxResponse
      
      if (!cursor) {
        setMessages(data.messages)
        setNextCursor(data.nextCursor)
        setTotal(data.total)
        return
      }
      setMessages(prev => [...prev, ...data.messages])
      setNextCursor(data.nextCursor)
      setTotal(data.total)
    } catch (error) {
      console.error("Failed to fetch inbox messages:", error)
    } finally {
      setLoading(false)
      setRefreshing(false)
      setLoadingMore(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchMessages()
  }

  const handleScroll = useThrottle((e: React.UIEvent<HTMLDivElement>) => {
    if (loadingMore) return

    const { scrollHeight, scrollTop, clientHeight } = e.currentTarget
    const threshold = clientHeight * 1.5
    const remainingScroll = scrollHeight - scrollTop

    if (remainingScroll <= threshold && nextCursor) {
      setLoadingMore(true)
      fetchMessages(nextCursor)
    }
  }, 200)

  useEffect(() => {
    if (session) fetchMessages()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, debouncedSearchQuery])

  if (!session) return null

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 flex justify-between items-center border-b border-primary/20">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
            className={cn("h-8 w-8", refreshing && "animate-spin")}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <span className="text-xs text-gray-500">
            {t("messageCount", { count: total })}
          </span>
        </div>
      </div>

      <div className="p-2 border-b border-primary/10">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="h-8 pl-8 pr-8"
          />
          {hasSearchQuery && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute right-0.5 top-1/2 h-7 w-7 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchQuery("")}
              aria-label={t("clearSearch")}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      
      <div className="flex-1 overflow-auto p-2" onScroll={handleScroll}>
        {loading ? (
          <div className="text-center text-sm text-gray-500">{t("loading")}</div>
        ) : messages.length > 0 ? (
          <div className="space-y-1">
            {messages.map(message => (
              <div
                key={message.id}
                className={cn("flex items-start gap-2 p-2 rounded cursor-pointer text-sm group",
                  "hover:bg-primary/5",
                  selectedMessageId === message.id && "bg-primary/10"
                )}
                onClick={() => onMessageSelect(message)}
              >
                <Mail className="h-4 w-4 text-primary/60 mt-0.5 shrink-0" />
                <div className="truncate flex-1 min-w-0">
                  <div className="font-medium truncate">{message.subject}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {message.from_address} → {message.emailAddress}
                  </div>
                  <div className="text-xs text-gray-400">
                    {message.received_at && new Date(message.received_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
            {loadingMore && (
              <div className="text-center text-sm text-gray-500 py-2">
                {t("loadingMore")}
              </div>
            )}
          </div>
        ) : (
          <div className="text-center text-sm text-gray-500">
            {hasSearchQuery ? t("noSearchResults") : t("noMessages")}
          </div>
        )}
      </div>
    </div>
  )
}
