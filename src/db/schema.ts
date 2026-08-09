import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'

const now = () => new Date().toISOString()

export const users = sqliteTable('users', {
  /** Telegram chat id, stored as text so large ids never lose precision. */
  id: text('id').primaryKey(),
  displayName: text('display_name'),

  /** Local hour the assistant stops nudging, and the hour it may resume. */
  quietStartHour: integer('quiet_start_hour').notNull().default(21),
  quietEndHour: integer('quiet_end_hour').notNull().default(8),

  maxNudgesPerDay: integer('max_nudges_per_day').notNull().default(3),
  minNudgeGapMinutes: integer('min_nudge_gap_minutes').notNull().default(180),

  /** When true the proactive engine skips this traveler entirely. */
  paused: integer('paused', { mode: 'boolean' }).notNull().default(false),

  createdAt: text('created_at').notNull().$defaultFn(now),
})

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  text: text('text').notNull(),
  /** Set when the assistant spoke first rather than replying. */
  proactive: integer('proactive', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull().$defaultFn(now),
})

/**
 * Where the traveler is, and when. History is kept - the journal is built from it.
 */
export const stays = sqliteTable('stays', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),

  city: text('city').notNull(),
  region: text('region'),
  country: text('country'),
  /** ISO 3166-1 alpha-2, resolved by the geocoder. */
  countryCode: text('country_code'),
  latitude: real('latitude'),
  longitude: real('longitude'),
  timezone: text('timezone'),

  /** Free text: hotel name, neighbourhood, "friend's place in Barranco". */
  lodgingName: text('lodging_name'),
  lodgingArea: text('lodging_area'),

  arrivalDate: text('arrival_date'),
  departureDate: text('departure_date'),

  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
})

export const plans = sqliteTable('plans', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  onDate: text('on_date'),
  atTime: text('at_time'),
  status: text('status', { enum: ['idea', 'booked', 'done', 'dropped'] })
    .notNull()
    .default('idea'),
  createdAt: text('created_at').notNull().$defaultFn(now),
})

export const preferences = sqliteTable('preferences', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  kind: text('kind', { enum: ['like', 'dislike', 'constraint'] }).notNull(),
  text: text('text').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(now),
})

export const journal = sqliteTable('journal', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  stayId: integer('stay_id'),
  kind: text('kind', { enum: ['note', 'photo'] })
    .notNull()
    .default('note'),
  text: text('text').notNull(),
  photoPath: text('photo_path'),
  occurredOn: text('occurred_on'),
  createdAt: text('created_at').notNull().$defaultFn(now),
})

/** Every proactive message sent, so the engine can rate-limit and avoid repeats. */
export const nudges = sqliteTable('nudges', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id').notNull(),
  topic: text('topic').notNull(),
  text: text('text').notNull(),
  sentAt: text('sent_at').notNull().$defaultFn(now),
})
