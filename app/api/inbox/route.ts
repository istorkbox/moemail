import { createDb } from "@/lib/db"
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm"
import { NextResponse } from "next/server"
import { emails, messages } from "@/lib/schema"
import { encodeCursor, decodeCursor } from "@/lib/cursor"
import { getUserId } from "@/lib/apiKey"

export const runtime = "edge"

const PAGE_SIZE = 20
const MAX_DELETE_COUNT = 100

export async function GET(request: Request) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(request.url)
  const cursor = searchParams.get("cursor")
  const search = searchParams.get("search")

  const db = createDb()

  try {
    const conditions = [
      and(
        eq(emails.userId, userId),
        gt(emails.expiresAt, new Date()),
        or(
          ne(messages.type, "sent"),
          isNull(messages.type)
        )
      )
    ]

    if (search && search.trim()) {
      const searchTerm = search.trim().toLowerCase()
      conditions.push(
        or(
          sql`LOWER(${messages.subject}) LIKE ${`%${searchTerm}%`}`,
          sql`LOWER(${messages.fromAddress}) LIKE ${`%${searchTerm}%`}`,
          sql`LOWER(${messages.toAddress}) LIKE ${`%${searchTerm}%`}`
        )
      )
    }

    const totalResult = await db.select({ count: sql<number>`count(*)` })
      .from(messages)
      .innerJoin(emails, eq(messages.emailId, emails.id))
      .where(and(...conditions))
    const totalCount = Number(totalResult[0].count)

    if (cursor) {
      const { timestamp, id } = decodeCursor(cursor)
      conditions.push(
        or(
          lt(messages.receivedAt, new Date(timestamp)),
          and(
            eq(messages.receivedAt, new Date(timestamp)),
            lt(messages.id, id)
          )
        )
      )
    }

    const results = await db.select({
      id: messages.id,
      emailId: messages.emailId,
      emailAddress: emails.address,
      fromAddress: messages.fromAddress,
      toAddress: messages.toAddress,
      subject: messages.subject,
      content: messages.content,
      html: messages.html,
      receivedAt: messages.receivedAt,
      sentAt: messages.sentAt,
      type: messages.type
    })
      .from(messages)
      .innerJoin(emails, eq(messages.emailId, emails.id))
      .where(and(...conditions))
      .orderBy(desc(messages.receivedAt), desc(messages.id))
      .limit(PAGE_SIZE + 1)

    const hasMore = results.length > PAGE_SIZE
    const nextCursor = hasMore
      ? encodeCursor(
          results[PAGE_SIZE - 1].receivedAt.getTime(),
          results[PAGE_SIZE - 1].id
        )
      : null
    const messageList = hasMore ? results.slice(0, PAGE_SIZE) : results

    return NextResponse.json({
      messages: messageList.map(msg => ({
        id: msg.id,
        emailId: msg.emailId,
        emailAddress: msg.emailAddress,
        from_address: msg.fromAddress,
        to_address: msg.toAddress,
        subject: msg.subject,
        content: msg.content,
        html: msg.html,
        received_at: msg.receivedAt.getTime(),
        sent_at: msg.sentAt?.getTime()
      })),
      nextCursor,
      total: totalCount
    })
  } catch (error) {
    console.error("Failed to fetch inbox messages:", error)
    return NextResponse.json(
      { error: "Failed to fetch inbox messages" },
      { status: 500 }
    )
  }
}

export async function DELETE(request: Request) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  try {
    const body = await request.json().catch(() => null) as { messageIds?: unknown } | null
    const messageIds = Array.isArray(body?.messageIds)
      ? Array.from(new Set(
          body.messageIds.filter((id): id is string => typeof id === "string" && id.length > 0)
        ))
      : []

    if (messageIds.length === 0) {
      return NextResponse.json(
        { error: "No messages selected" },
        { status: 400 }
      )
    }

    if (messageIds.length > MAX_DELETE_COUNT) {
      return NextResponse.json(
        { error: `Cannot delete more than ${MAX_DELETE_COUNT} messages at once` },
        { status: 400 }
      )
    }

    const db = createDb()
    const ownedMessages = await db.select({ id: messages.id })
      .from(messages)
      .innerJoin(emails, eq(messages.emailId, emails.id))
      .where(and(
        eq(emails.userId, userId),
        inArray(messages.id, messageIds),
        or(
          ne(messages.type, "sent"),
          isNull(messages.type)
        )
      ))

    const ownedMessageIds = ownedMessages.map(message => message.id)
    if (ownedMessageIds.length === 0) {
      return NextResponse.json({ deleted: 0 })
    }

    await db.delete(messages)
      .where(inArray(messages.id, ownedMessageIds))

    return NextResponse.json({ deleted: ownedMessageIds.length })
  } catch (error) {
    console.error("Failed to delete inbox messages:", error)
    return NextResponse.json(
      { error: "Failed to delete inbox messages" },
      { status: 500 }
    )
  }
}
