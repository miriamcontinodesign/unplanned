import { integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const now = () => new Date().toISOString()

/**
 * A traveler. Identity is deliberately decoupled from any one channel: a user
 * may exist with only a web session, only a Telegram chat, or both once linked.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    displayName: text('display_name'),

    /** Set once a Telegram chat is linked. Null for web-only travelers. */
    telegramChatId: text('telegram_chat_id'),

    /** Local hour the assistant stops nudging, and the hour it may resume. */
    quietStartHour: integer('quiet_start_hour').notNull().default(21),
    quietEndHour: integer('quiet_end_hour').notNull().default(8),

    maxNudgesPerDay: integer('max_nudges_per_day').notNull().default(3),
    minNudgeGapMinutes: integer('min_nudge_gap_minutes').notNull().default(180),

    /** When true the proactive engine skips this traveler entirely. */
    paused: integer('paused', { mode: 'boolean' }).notNull().default(false),

    createdAt: text('created_at').notNull().$defaultFn(now),
  },
  (table) => ({
    telegramChatIdx: uniqueIndex('users_telegram_chat_id_idx').on(table.telegramChatId),
  }),
)

/** Browser sessions. The cookie value is the token; there is no password. */
export const sessions = sqliteTable('sessions', {
  token: text('token').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(now),
  lastSeenAt: text('last_seen_at').notNull().$defaultFn(now),
})

/** Short-lived codes a web traveler sends to the bot to merge the two identities. */
export const linkCodes = sqliteTable('link_codes', {
  code: text('code').primaryKey(),
  userId: text('user_id').notNull(),
  createdAt: text('created_at').notNull().$defaultFn(now),
  expiresAt: text('expires_at').notNull(),
  consumedAt: text('consumed_at'),
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
 * An itinerary leg: where the traveler is or is going, and when. History is
 * kept, so the journal and the trip overview are both built from this table.
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
  /** Set when the traveler gave a duration rather than dates. */
  nights: integer('nights'),

  budgetLevel: text('budget_level', {
    enum: ['shoestring', 'moderate', 'comfortable', 'luxury'],
  }),
  partySize: integer('party_size'),
  partyKind: text('party_kind', { enum: ['solo', 'couple', 'family', 'friends'] }),

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
  /** Where this was learned, so the UI can show the traveler why it knows something. */
  source: text('source', { enum: ['onboarding', 'chat', 'booking'] })
    .notNull()
    .default('chat'),
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

/**
 * Activity bookings. `held` is a reservation awaiting confirmation, `deeplinked`
 * means the traveler was handed off to the operator's own checkout.
 */
export const bookings = sqliteTable('bookings', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),

  provider: text('provider').notNull(),
  productCode: text('product_code').notNull(),
  productTitle: text('product_title').notNull(),
  optionCode: text('option_code'),
  optionTitle: text('option_title'),

  travelDate: text('travel_date').notNull(),
  startTime: text('start_time'),
  partySize: integer('party_size').notNull().default(1),

  currency: text('currency').notNull().default('USD'),
  totalAmount: real('total_amount').notNull().default(0),

  status: text('status', {
    enum: ['held', 'confirmed', 'cancelled', 'deeplinked', 'failed'],
  })
    .notNull()
    .default('held'),

  holdRef: text('hold_ref'),
  bookingRef: text('booking_ref'),
  /** Set in deeplink mode: where the traveler completes the purchase. */
  bookingUrl: text('booking_url'),
  cancellationPolicy: text('cancellation_policy'),

  holdExpiresAt: text('hold_expires_at'),
  createdAt: text('created_at').notNull().$defaultFn(now),
  updatedAt: text('updated_at').notNull().$defaultFn(now),
})
