import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from './index.js'
import {
  bookings,
  journal,
  linkCodes,
  messages,
  nudges,
  plans,
  preferences,
  sessions,
  stays,
  users,
} from './schema.js'
import { startOfLocalDayUtcIso } from '../util/time.js'
import * as ids from '../util/ids.js'

export type User = typeof users.$inferSelect
export type Message = typeof messages.$inferSelect
export type Stay = typeof stays.$inferSelect
export type Plan = typeof plans.$inferSelect
export type Preference = typeof preferences.$inferSelect
export type JournalEntry = typeof journal.$inferSelect
export type Nudge = typeof nudges.$inferSelect
export type Booking = typeof bookings.$inferSelect

// ---------------------------------------------------------------- users

export function getUser(id: string): User | undefined {
  return db.select().from(users).where(eq(users.id, id)).get()
}

export function createUser(displayName?: string | null): User {
  const id = ids.userId()
  db.insert(users)
    .values({ id, displayName: displayName ?? null })
    .run()
  return getUser(id)!
}

export function getUserByTelegramChat(chatId: string): User | undefined {
  return db.select().from(users).where(eq(users.telegramChatId, chatId)).get()
}

export function getOrCreateUserByTelegram(chatId: string, displayName?: string | null): User {
  const existing = getUserByTelegramChat(chatId)
  if (existing) {
    if (displayName && displayName !== existing.displayName) {
      db.update(users).set({ displayName }).where(eq(users.id, existing.id)).run()
      return { ...existing, displayName }
    }
    return existing
  }
  const id = ids.userId()
  db.insert(users)
    .values({ id, telegramChatId: chatId, displayName: displayName ?? null })
    .run()
  return getUser(id)!
}

export function updateUser(id: string, patch: Partial<Omit<User, 'id' | 'createdAt'>>): void {
  db.update(users).set(patch).where(eq(users.id, id)).run()
}

/** Travelers eligible for proactive messages: reachable, and not paused. */
export function listActiveUsers(): User[] {
  return db
    .select()
    .from(users)
    .where(and(eq(users.paused, false), isNotNull(users.telegramChatId)))
    .all()
}

// -------------------------------------------------------------- sessions

export function createSession(userId: string): string {
  const token = ids.sessionToken()
  db.insert(sessions).values({ token, userId }).run()
  return token
}

export function getUserBySession(token: string): User | undefined {
  const row = db.select().from(sessions).where(eq(sessions.token, token)).get()
  if (!row) return undefined
  db.update(sessions)
    .set({ lastSeenAt: new Date().toISOString() })
    .where(eq(sessions.token, token))
    .run()
  return getUser(row.userId)
}

/** Repoint a session after a merge, so the browser cookie stays valid. */
export function repointSessions(fromUserId: string, toUserId: string): void {
  db.update(sessions).set({ userId: toUserId }).where(eq(sessions.userId, fromUserId)).run()
}

// ------------------------------------------------------------ link codes

const LINK_CODE_TTL_MINUTES = 30

export function createLinkCode(userId: string): { code: string; expiresAt: string } {
  // One live code per traveler: issuing a new one retires any earlier code.
  db.update(linkCodes)
    .set({ consumedAt: new Date().toISOString() })
    .where(and(eq(linkCodes.userId, userId), isNull(linkCodes.consumedAt)))
    .run()

  const code = ids.linkCode()
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60_000).toISOString()
  db.insert(linkCodes).values({ code, userId, expiresAt }).run()
  return { code, expiresAt }
}

export type LinkOutcome =
  | { ok: true; userId: string; mergedFrom: string | null }
  | { ok: false; reason: 'unknown' | 'expired' | 'used' | 'already-linked' }

/**
 * Redeem a code sent to the bot. The web traveler wins the merge: they are the
 * session actively on screen, and they hold the onboarding answers.
 */
export function redeemLinkCode(rawCode: string, telegramChatId: string, displayName?: string | null): LinkOutcome {
  const code = rawCode.trim().toUpperCase()
  const row = db.select().from(linkCodes).where(eq(linkCodes.code, code)).get()
  if (!row) return { ok: false, reason: 'unknown' }
  if (row.consumedAt) return { ok: false, reason: 'used' }
  if (Date.parse(row.expiresAt) < Date.now()) return { ok: false, reason: 'expired' }

  const webUser = getUser(row.userId)
  if (!webUser) return { ok: false, reason: 'unknown' }
  if (webUser.telegramChatId && webUser.telegramChatId !== telegramChatId) {
    return { ok: false, reason: 'already-linked' }
  }

  const existing = getUserByTelegramChat(telegramChatId)
  let mergedFrom: string | null = null

  if (existing && existing.id !== webUser.id) {
    // Free the unique index before the target claims the chat id.
    db.update(users).set({ telegramChatId: null }).where(eq(users.id, existing.id)).run()
    mergeUserData(existing.id, webUser.id)
    db.delete(users).where(eq(users.id, existing.id)).run()
    mergedFrom = existing.id
  }

  db.update(users)
    .set({ telegramChatId, displayName: webUser.displayName ?? displayName ?? null })
    .where(eq(users.id, webUser.id))
    .run()

  db.update(linkCodes)
    .set({ consumedAt: new Date().toISOString() })
    .where(eq(linkCodes.code, code))
    .run()

  return { ok: true, userId: webUser.id, mergedFrom }
}

/** Move every row owned by one traveler onto another, then fix up invariants. */
function mergeUserData(fromId: string, toId: string): void {
  db.transaction((tx) => {
    for (const table of [messages, stays, plans, preferences, journal, nudges, bookings]) {
      tx.update(table).set({ userId: toId }).where(eq(table.userId, fromId)).run()
    }
    tx.update(sessions).set({ userId: toId }).where(eq(sessions.userId, fromId)).run()
    tx.update(linkCodes).set({ userId: toId }).where(eq(linkCodes.userId, fromId)).run()
  })

  // Both sides may have had a current stay; only the freshest survives as current.
  const current = db
    .select()
    .from(stays)
    .where(and(eq(stays.userId, toId), eq(stays.isCurrent, true)))
    .orderBy(desc(stays.updatedAt), desc(stays.id))
    .all()

  for (const stale of current.slice(1)) {
    db.update(stays).set({ isCurrent: false }).where(eq(stays.id, stale.id)).run()
  }
}

// ------------------------------------------------------------- messages

export function addMessage(
  userId: string,
  role: 'user' | 'assistant',
  text: string,
  proactive = false,
): void {
  db.insert(messages).values({ userId, role, text, proactive }).run()
}

/** Most recent messages, returned oldest-first so they read as a transcript. */
export function recentMessages(userId: string, limit = 20): Message[] {
  const rows = db
    .select()
    .from(messages)
    .where(eq(messages.userId, userId))
    .orderBy(desc(messages.id))
    .limit(limit)
    .all()
  return rows.reverse()
}

// ----------------------------------------------------------------- stays

export function currentStay(userId: string): Stay | undefined {
  return db
    .select()
    .from(stays)
    .where(and(eq(stays.userId, userId), eq(stays.isCurrent, true)))
    .orderBy(desc(stays.id))
    .get()
}

export function listStays(userId: string): Stay[] {
  return db.select().from(stays).where(eq(stays.userId, userId)).orderBy(stays.id).all()
}

type StayPatch = Partial<Omit<Stay, 'id' | 'userId' | 'createdAt' | 'updatedAt' | 'isCurrent'>>

/**
 * Update the current stay in place, or open a new one when the city changes.
 * Returns the stay that is current afterwards.
 */
export function upsertCurrentStay(userId: string, patch: StayPatch & { city: string }): Stay {
  const existing = currentStay(userId)
  const sameCity =
    existing && existing.city.trim().toLowerCase() === patch.city.trim().toLowerCase()

  if (existing && sameCity) {
    // Never overwrite a known value with null - callers report only what the
    // latest input mentioned, not the full picture.
    const merged: Record<string, unknown> = { updatedAt: new Date().toISOString() }
    for (const [key, value] of Object.entries(patch)) {
      if (value !== null && value !== undefined) merged[key] = value
    }
    db.update(stays).set(merged).where(eq(stays.id, existing.id)).run()
    return db.select().from(stays).where(eq(stays.id, existing.id)).get()!
  }

  if (existing) {
    db.update(stays).set({ isCurrent: false }).where(eq(stays.id, existing.id)).run()
  }

  db.insert(stays)
    .values({ ...patch, userId, isCurrent: true })
    .run()

  return currentStay(userId)!
}

export function setStayGeo(
  stayId: number,
  geo: {
    latitude: number
    longitude: number
    timezone: string
    region: string | null
    country: string | null
    countryCode: string | null
  },
): void {
  db.update(stays)
    .set({ ...geo, updatedAt: new Date().toISOString() })
    .where(eq(stays.id, stayId))
    .run()
}

// ----------------------------------------------------------------- plans

export function listOpenPlans(userId: string): Plan[] {
  return db
    .select()
    .from(plans)
    .where(and(eq(plans.userId, userId), sql`${plans.status} in ('idea','booked')`))
    .orderBy(plans.onDate, plans.id)
    .all()
}

export function listAllPlans(userId: string): Plan[] {
  return db.select().from(plans).where(eq(plans.userId, userId)).orderBy(plans.id).all()
}

export type PlanInput = {
  title: string
  detail?: string | null
  dayIndex?: number | null
  onDate?: string | null
  atTime?: string | null
  provider?: string | null
  productCode?: string | null
  priceAmount?: number | null
  currency?: string | null
  durationMinutes?: number | null
  status?: Plan['status']
}

export function addPlan(userId: string, plan: PlanInput): Plan {
  db.insert(plans)
    .values({
      userId,
      title: plan.title,
      detail: plan.detail ?? null,
      dayIndex: plan.dayIndex ?? null,
      onDate: plan.onDate ?? null,
      atTime: plan.atTime ?? null,
      provider: plan.provider ?? null,
      productCode: plan.productCode ?? null,
      priceAmount: plan.priceAmount ?? null,
      currency: plan.currency ?? null,
      durationMinutes: plan.durationMinutes ?? null,
      status: plan.status ?? 'idea',
    })
    .run()

  return db
    .select()
    .from(plans)
    .where(eq(plans.userId, userId))
    .orderBy(desc(plans.id))
    .get()!
}

/**
 * Product codes the traveler has already accepted or passed on, so the
 * recommender stops surfacing them. Passing on something hides it from the
 * itinerary but keeps it here.
 */
export function decidedProductCodes(userId: string): Set<string> {
  const rows = db
    .select({ productCode: plans.productCode })
    .from(plans)
    .where(and(eq(plans.userId, userId), isNotNull(plans.productCode)))
    .all()
  return new Set(rows.map((row) => row.productCode!).filter(Boolean))
}

export function setPlanStatus(userId: string, planId: number, status: Plan['status']): void {
  db.update(plans)
    .set({ status })
    .where(and(eq(plans.userId, userId), eq(plans.id, planId)))
    .run()
}

// ----------------------------------------------------------- preferences

export function listPreferences(userId: string): Preference[] {
  return db
    .select()
    .from(preferences)
    .where(eq(preferences.userId, userId))
    .orderBy(preferences.id)
    .all()
}

export function addPreference(
  userId: string,
  kind: Preference['kind'],
  text: string,
  source: Preference['source'] = 'chat',
): void {
  const normalised = text.trim().toLowerCase()
  if (!normalised) return
  const existing = listPreferences(userId)
  if (existing.some((p) => p.text.trim().toLowerCase() === normalised)) return
  db.insert(preferences).values({ userId, kind, text: text.trim(), source }).run()
}

export function removePreference(userId: string, id: number): void {
  db.delete(preferences)
    .where(and(eq(preferences.userId, userId), eq(preferences.id, id)))
    .run()
}

// --------------------------------------------------------------- journal

export function addJournalEntry(entry: {
  userId: string
  stayId?: number | null
  kind?: JournalEntry['kind']
  text: string
  photoPath?: string | null
  occurredOn?: string | null
}): void {
  db.insert(journal)
    .values({
      userId: entry.userId,
      stayId: entry.stayId ?? null,
      kind: entry.kind ?? 'note',
      text: entry.text,
      photoPath: entry.photoPath ?? null,
      occurredOn: entry.occurredOn ?? null,
    })
    .run()
}

export function listJournal(userId: string): JournalEntry[] {
  return db.select().from(journal).where(eq(journal.userId, userId)).orderBy(journal.id).all()
}

// ---------------------------------------------------------------- nudges

export function addNudge(userId: string, topic: string, text: string): void {
  db.insert(nudges).values({ userId, topic, text }).run()
}

export function recentNudges(userId: string, limit = 10): Nudge[] {
  return db
    .select()
    .from(nudges)
    .where(eq(nudges.userId, userId))
    .orderBy(desc(nudges.id))
    .limit(limit)
    .all()
}

export function lastNudgeAt(userId: string): string | null {
  const row = db
    .select({ sentAt: nudges.sentAt })
    .from(nudges)
    .where(eq(nudges.userId, userId))
    .orderBy(desc(nudges.id))
    .limit(1)
    .get()
  return row?.sentAt ?? null
}

/** Nudges sent since local midnight in the traveler's current timezone. */
export function nudgeCountToday(userId: string, timezone: string | null | undefined): number {
  const since = startOfLocalDayUtcIso(timezone)
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(nudges)
    .where(and(eq(nudges.userId, userId), gte(nudges.sentAt, since)))
    .get()
  return row?.count ?? 0
}

// -------------------------------------------------------------- bookings

export function createBooking(
  booking: Omit<Booking, 'id' | 'createdAt' | 'updatedAt'>,
): Booking {
  const id = ids.bookingId()
  db.insert(bookings)
    .values({ ...booking, id })
    .run()
  return getBooking(id)!
}

export function getBooking(id: string): Booking | undefined {
  return db.select().from(bookings).where(eq(bookings.id, id)).get()
}

export function updateBooking(
  id: string,
  patch: Partial<Omit<Booking, 'id' | 'userId' | 'createdAt'>>,
): Booking | undefined {
  db.update(bookings)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(bookings.id, id))
    .run()
  return getBooking(id)
}

export function listBookings(userId: string): Booking[] {
  return db
    .select()
    .from(bookings)
    .where(eq(bookings.userId, userId))
    .orderBy(desc(bookings.createdAt))
    .all()
}
