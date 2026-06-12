"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Mail, RefreshCw, Search, Trash2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useThrottle } from "@/hooks/use-throttle"

const PAGE_SIZE_OPTIONS = ["10", "20", "50", "100"]

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
  onMessagesDelete?: (messageIds: string[]) => void
}

interface InboxResponse {
  messages: Message[]
  nextCursor: string | null
  total: number
}

interface DeleteResponse {
  deleted?: number
}

export function InboxList({ onMessageSelect, selectedMessageId, onMessagesDelete }: InboxListProps) {
  const { data: session } = useSession()
  const t = useTranslations("emails.inbox")
  const tCommon = useTranslations("common.actions")
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pageSize, setPageSize] = useState("20")
  const [total, setTotal] = useState(0)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("")
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([])
  const [error, setError] = useState(false)
  const requestGenerationRef = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const hasSearchQuery = debouncedSearchQuery.trim().length > 0
  const visibleMessageIds = messages.map(message => message.id)
  const selectedCount = selectedMessageIds.length
  const allVisibleSelected = visibleMessageIds.length > 0
    && visibleMessageIds.every(id => selectedMessageIds.includes(id))

  const fetchMessages = async (cursor?: string) => {
    const requestGeneration = cursor ? requestGenerationRef.current : requestGenerationRef.current + 1
    if (!cursor) {
      requestGenerationRef.current = requestGeneration
    }

    try {
      const url = new URL("/api/inbox", window.location.origin)
      url.searchParams.set("limit", pageSize)
      if (cursor) {
        url.searchParams.set("cursor", cursor)
      }
      if (debouncedSearchQuery.trim()) {
        url.searchParams.set("search", debouncedSearchQuery.trim())
      }

      setError(false)
      const response = await fetch(url)
      if (requestGeneration !== requestGenerationRef.current) return
      if (!response.ok) {
        throw new Error(`Failed to fetch inbox messages: ${response.status}`)
      }

      const data = await response.json() as InboxResponse
      const nextMessages = Array.isArray(data.messages) ? data.messages : []
      const nextTotal = typeof data.total === "number" ? data.total : nextMessages.length

      if (!cursor) {
        setMessages(nextMessages)
        setNextCursor(data.nextCursor ?? null)
        setTotal(nextTotal)
        return
      }

      setMessages(prev => [...prev, ...nextMessages])
      setNextCursor(data.nextCursor ?? null)
      setTotal(nextTotal)
    } catch (error) {
      if (requestGeneration === requestGenerationRef.current) {
        console.error("Failed to fetch inbox messages:", error)
        setError(true)
        if (!cursor) {
          setMessages([])
          setNextCursor(null)
          setTotal(0)
        }
      }
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        setLoading(false)
        setRefreshing(false)
        setLoadingMore(false)
      }
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    await fetchMessages()
  }

  const handleDeleteSelected = async () => {
    if (selectedMessageIds.length === 0) return

    const messageIds = selectedMessageIds
    try {
      setDeleting(true)
      const response = await fetch("/api/inbox", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ messageIds })
      })

      if (!response.ok) {
        throw new Error(`Failed to delete inbox messages: ${response.status}`)
      }

      const data = await response.json().catch(() => ({})) as DeleteResponse
      const deletedCount = typeof data.deleted === "number" ? data.deleted : messageIds.length
      const deletedIds = new Set(messageIds)

      setMessages(prev => prev.filter(message => !deletedIds.has(message.id)))
      setTotal(prev => Math.max(0, prev - deletedCount))
      setSelectedMessageIds([])
      onMessagesDelete?.(messageIds)
    } catch (error) {
      console.error("Failed to delete inbox messages:", error)
      setError(true)
    } finally {
      setDeleting(false)
    }
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

  const toggleMessageSelection = (messageId: string, checked: boolean) => {
    setSelectedMessageIds(prev => {
      if (checked) {
        return prev.includes(messageId) ? prev : [...prev, messageId]
      }
      return prev.filter(id => id !== messageId)
    })
  }

  const toggleVisibleSelection = (checked: boolean) => {
    setSelectedMessageIds(prev => {
      if (!checked) {
        return prev.filter(id => !visibleMessageIds.includes(id))
      }
      return Array.from(new Set([...prev, ...visibleMessageIds]))
    })
  }

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return ""
    return new Date(timestamp).toLocaleString()
  }

  useEffect(() => {
    if (!session) return

    setLoading(true)
    setNextCursor(null)
    setLoadingMore(false)
    setSelectedMessageIds([])
    fetchMessages()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, debouncedSearchQuery, pageSize])

  if (!session) return null

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 flex items-center gap-2 border-b border-primary/20">
        <div onClick={(event) => event.stopPropagation()}>
          <Checkbox
            checked={allVisibleSelected}
            onChange={toggleVisibleSelection}
            disabled={messages.length === 0 || deleting}
            className="h-4 w-4"
          />
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleRefresh}
          disabled={refreshing || deleting}
          className={cn("h-8 w-8 shrink-0", refreshing && "animate-spin")}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
        {selectedCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleDeleteSelected}
            disabled={deleting}
            className="h-8 gap-1 px-2 text-destructive hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden sm:inline">{tCommon("delete")}</span>
          </Button>
        )}
        <Select value={pageSize} onValueChange={setPageSize} disabled={loading || deleting}>
          <SelectTrigger className="h-8 w-[72px] px-2">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map(option => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="ml-auto text-xs text-gray-500 whitespace-nowrap">
          {selectedCount > 0 ? `${selectedCount}/${total}` : t("messageCount", { count: total })}
        </span>
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

      <div className="flex-1 overflow-auto" onScroll={handleScroll}>
        {loading ? (
          <div className="p-4 text-center text-sm text-gray-500">{t("loading")}</div>
        ) : error ? (
          <div className="p-4 text-center text-sm text-gray-500">
            {t("noMessages")}
          </div>
        ) : messages.length > 0 ? (
          <div className="divide-y divide-primary/10">
            {messages.map(message => (
              <div
                key={message.id}
                className={cn(
                  "flex items-center gap-2 px-2 py-2 cursor-pointer text-sm group hover:bg-primary/5",
                  selectedMessageId === message.id && "bg-primary/10"
                )}
                onClick={() => onMessageSelect(message)}
              >
                <div onClick={(event) => event.stopPropagation()}>
                  <Checkbox
                    checked={selectedMessageIds.includes(message.id)}
                    onChange={(checked) => toggleMessageSelection(message.id, checked)}
                    disabled={deleting}
                    className="h-4 w-4"
                  />
                </div>
                <Mail className="h-4 w-4 text-primary/60 shrink-0" />
                <div className="min-w-0 flex-1 md:grid md:grid-cols-[minmax(8rem,12rem)_minmax(7rem,10rem)_minmax(0,1fr)] md:items-center md:gap-3">
                  <div className="truncate font-medium text-primary">
                    {message.emailAddress}
                  </div>
                  <div className="truncate text-xs text-gray-500 md:text-sm md:text-foreground md:font-normal">
                    {message.from_address || "-"}
                  </div>
                  <div className="min-w-0 truncate">
                    <span className="font-medium">{message.subject}</span>
                    {message.content && (
                      <span className="hidden sm:inline text-gray-400">
                        {" "}{message.content}
                      </span>
                    )}
                  </div>
                </div>
                <div className="hidden sm:block w-24 shrink-0 truncate text-right text-xs text-gray-500">
                  {formatTime(message.received_at)}
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
          <div className="p-4 text-center text-sm text-gray-500">
            {hasSearchQuery ? t("noSearchResults") : t("noMessages")}
          </div>
        )}
      </div>
    </div>
  )
}
