import { createDb } from "@/lib/db"
import { and, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm"
import { NextResponse } from "next/server"
import { emails, messages } from "@/lib/schema"
import { encodeCursor, decodeCursor } from "@/lib/cursor"
import { getUserId } from "@/lib/apiKey"

export const runtime = "edge"

const PAGE_SIZE = 20

/**
 * 全局收件箱API - 获取用户所有邮箱的邮件列表
 * 按接收时间倒序排列，支持游标分页
 */
export async function GET(request: Request) {
  const userId = await getUserId()

  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(request.url)
  const cursor = searchParams.get('cursor')
  const search = searchParams.get('search')
  
  const db = createDb()

  try {
    // 获取用户的所有有效邮箱ID
    const userEmails = await db.query.emails.findMany({
      where: and(
        eq(emails.userId, userId),
        gt(emails.expiresAt, new Date())
      ),
      columns: { id: true }
    })

    const emailIds = userEmails.map((e: { id: string }) => e.id)

    if (emailIds.length === 0) {
      return NextResponse.json({ 
        messages: [],
        nextCursor: null,
        total: 0
      })
    }

    // 构建基础查询条件
    let conditions: any = and(
      inArray(messages.emailId, emailIds),
      or(
        ne(messages.type, "sent"),
        isNull(messages.type)
      )
    )

    // 添加搜索条件
    if (search && search.trim()) {
      const searchTerm = search.trim().toLowerCase()
      conditions = and(
        conditions,
        or(
          sql`LOWER(${messages.subject}) LIKE ${`%${searchTerm}%`}`,
          sql`LOWER(${messages.fromAddress}) LIKE ${`%${searchTerm}%`}`,
          sql`LOWER(${messages.toAddress}) LIKE ${`%${searchTerm}%`}`
        )
      )
    }

    // 获取总数
    const totalResult = await db.select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(conditions)
    const totalCount = Number(totalResult[0].count)

    // 构建分页条件
    const whereConditions = [conditions]

    if (cursor) {
      const { timestamp, id } = decodeCursor(cursor)
      whereConditions.push(
        or(
          lt(messages.receivedAt, new Date(timestamp)),
          and(
            eq(messages.receivedAt, new Date(timestamp)),
            lt(messages.id, id)
          )
        )
      )
    }

    // 查询邮件列表，需要关联邮箱地址
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
    .where(and(...whereConditions))
    .orderBy(desc(messages.receivedAt), desc(messages.id))
    .limit(PAGE_SIZE + 1)

    const hasMore = results.length > PAGE_SIZE
    const nextCursor = hasMore 
      ? encodeCursor(
          results[PAGE_SIZE - 1].receivedAt?.getTime() || 0,
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
        received_at: msg.receivedAt?.getTime(),
        sent_at: msg.sentAt?.getTime()
      })),
      nextCursor,
      total: totalCount
    })
  } catch (error) {
    console.error('Failed to fetch inbox messages:', error)
    return NextResponse.json(
      { error: "Failed to fetch inbox messages" },
      { status: 500 }
    )
  }
}
