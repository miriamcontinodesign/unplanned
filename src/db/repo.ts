import { and, desc, eq, gte, sql } from 'drizzle-orm'
import { db } from './index.js'
import { journal, messages, nudges, plans, preferences, stays, users } from './schema.js'
import { startOfLocalDayUtcIso } from '../util/time.js'

export type User = typeof users.$inferSelect
export type Message = typeof messages.$inferSelect
export type Stay = typeof stays.$inferSelect
export type Plan = typeof plans.$inferSelect
export type Preference = typeof preferences.$inferSelect
export type JournalEntry = typeof journal.$inferSelect
export type Nudge = typeof nudges.$inferSelect

// ---------------------------------------------------------------- users

export function getOrCreateUser(id: string, displayName?: string | null): User {
  const existing = db.select().from(users).where(eq(users.id, id)).get()
  if (existing) {
    if (displayName && displayName !== existing.displayName) {
      db.update(users).set({ displayName }).where(eq(users.id, id)).run()
      return { ...existing, displayName }
    }
    return existing
  }
  db.insert(users)
    .values({ id, displayName: displayName ?? null })
    .run()
  return db.select().from(users).where(eq(users.id, id)).get()!
}

export function updateUser(id: string, patch: Partial<Omit<User, 'id' | 'createdAt'>>): void {
  db.update(users).set(patch).where(eq(users.id, id)).run()
}

export function listActiveUsers(): User[] {
  return db.select().from(users).where(eq(users.paused, false)).all()
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
    // Never overwrite a known value with null - the extractor reports only what
    // the latest message mentioned, not the full picture.
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

export function addPlan(
  userId: string,
  plan: { title: string; detail?: string | null; onDate?: string | null; atTime?: string | null },
): void {
  db.insert(plans)
    .values({
      userId,
      title: plan.title,
      detail: plan.detail ?? null,
      onDate: plan.onDate ?? null,
      atTime: plan.atTime ?? null,
    })
    .run()
}

export function setPlanStatus(
  userId: string,
  planId: number,
  status: Plan['status'],
): void {
  db.update(plans)
    .set({ status })
    .where(and(eq(plans.userId, userId), eq(plans.id, planId)))
    .run()
}

// ----------------------------------------------------------- preferences

export function listPreferences(userId: string): Preference[] {
  return db.select().from(preferences).where(eq(preferences.userId, userId)).orderBy(preferences.id).all()
}

export function addPreference(userId: string, kind: Preference['kind'], text: string): void {
  const existing = listPreferences(userId)
  const normalised = text.trim().toLowerCase()
  if (existing.some((p) => p.text.trim().toLowerCase() === normalised)) return
  db.insert(preferences).values({ userId, kind, text: text.trim() }).run()
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
