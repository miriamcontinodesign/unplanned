import type {
  ExperienceSearchInput,
  ExperienceSearchResult,
  ViatorExperience,
} from '../services/viator.js'
import { viatorSessionId } from '../services/viator.js'

interface MockExperience extends ViatorExperience {
  /** Search-only context that is not exposed in the formatted result. */
  searchText: string
}

const DESTINATION_WORDS = new Set([
  'barcelona', 'brooklyn', 'italy', 'japan', 'lisbon', 'nyc', 'portugal', 'rome', 'spain', 'tokyo',
])

/** Deterministic demo catalog. Mock links can never be mistaken for bookings. */
export const MOCK_VIATOR_EXPERIENCES: readonly MockExperience[] = [
  {
    title: 'Fresh Pasta and Tiramisu Workshop in Trastevere',
    code: 'MOCK-ROME-PASTA',
    searchText: 'rome italy trastevere cooking class pasta tiramisu italian food hands-on indoor',
    thumbnail: 'https://images.example.invalid/roadio/rome-pasta.jpg',
    rating: 4.9,
    reviewCount: 1842,
    freeCancellation: true,
    fromPrice: 79,
    clickOffToLander: 'https://viator.example.invalid/mock/rome-pasta',
    contactPhone: '+12125550101',
    contactPhoneIsMock: true,
    duration: { fixedDurationInMinutes: 180 },
    keyAttributes: { features: ['Small group', 'Meal included'], mainCategory: 'Cooking Classes' },
  },
  {
    title: 'Brooklyn Pizza-Making Class with a Local Chef',
    code: 'MOCK-NYC-PIZZA',
    searchText: 'new york city nyc brooklyn cooking class pizza family friendly kids local chef indoor',
    thumbnail: 'https://images.example.invalid/roadio/brooklyn-pizza.jpg',
    rating: 4.8,
    reviewCount: 427,
    freeCancellation: true,
    fromPrice: 68,
    fromPriceBeforeDiscount: 85,
    clickOffToLander: 'https://viator.example.invalid/mock/brooklyn-pizza',
    contactPhone: '+12125550102',
    contactPhoneIsMock: true,
    duration: { fixedDurationInMinutes: 150 },
    keyAttributes: { features: ['Family friendly', 'Meal included'], mainCategory: 'Cooking Classes' },
  },
  {
    title: 'Sushi and Miso Soup Class in a Tokyo Home',
    code: 'MOCK-TOKYO-SUSHI',
    searchText: 'tokyo japan cooking class sushi miso japanese food small group home indoor',
    thumbnail: 'https://images.example.invalid/roadio/tokyo-sushi.jpg',
    rating: 5,
    reviewCount: 316,
    freeCancellation: true,
    fromPrice: 92,
    clickOffToLander: 'https://viator.example.invalid/mock/tokyo-sushi',
    contactPhone: '+12125550103',
    contactPhoneIsMock: true,
    duration: { variableDurationFromMinutes: 150, variableDurationToMinutes: 180 },
    keyAttributes: { features: ['Small group', 'Market ingredients'], mainCategory: 'Cooking Classes' },
  },
  {
    title: 'Paella and Tapas Class near La Boqueria',
    code: 'MOCK-BCN-PAELLA',
    searchText: 'barcelona spain la boqueria cooking class paella tapas spanish food market indoor',
    thumbnail: 'https://images.example.invalid/roadio/barcelona-paella.jpg',
    rating: 4.7,
    reviewCount: 965,
    freeCancellation: false,
    fromPrice: 61,
    clickOffToLander: 'https://viator.example.invalid/mock/barcelona-paella',
    contactPhone: '+12125550104',
    contactPhoneIsMock: true,
    duration: { fixedDurationInMinutes: 210 },
    keyAttributes: { features: ['Market visit', 'Meal included'], mainCategory: 'Cooking Classes' },
  },
  {
    title: 'After-Hours Pastel de Nata Workshop',
    code: 'MOCK-LISBON-NATAS',
    searchText: 'lisbon portugal baixa natas pastry food cooking workshop quiet solo low crowds evening tonight indoor late',
    thumbnail: 'https://images.example.invalid/roadio/lisbon-natas.jpg',
    rating: 4.9,
    reviewCount: 284,
    freeCancellation: true,
    fromPrice: 48,
    clickOffToLander: 'https://viator.example.invalid/mock/lisbon-natas',
    contactPhone: '+12125550105',
    contactPhoneIsMock: true,
    recommendationContext: {
      why: 'Quiet six-person workshop, an 8-minute walk from your stay, with a late seat tonight.',
      neighborhood: 'Baixa',
      walkingMinutes: 8,
      crowdLevel: 'quiet',
      availableStartTimes: ['19:30', '21:15'],
      availability: 'available',
    },
    duration: { fixedDurationInMinutes: 90 },
    keyAttributes: { features: ['Six guests max', 'Solo friendly'], mainCategory: 'Cooking Classes' },
  },
  {
    title: 'Cook a Portuguese Supper in Mouraria',
    code: 'MOCK-LISBON-SUPPER',
    searchText: 'lisbon portugal mouraria cooking class supper dinner food solo small group quiet local evening tonight indoor',
    thumbnail: 'https://images.example.invalid/roadio/lisbon-supper.jpg',
    rating: 4.8,
    reviewCount: 196,
    freeCancellation: true,
    fromPrice: 72,
    clickOffToLander: 'https://viator.example.invalid/mock/lisbon-supper',
    contactPhone: '+12125550107',
    contactPhoneIsMock: true,
    recommendationContext: {
      why: 'A host-led dinner with eight guests max—social enough for solo, without the tour-group feel.',
      neighborhood: 'Mouraria',
      walkingMinutes: 14,
      crowdLevel: 'quiet',
      availableStartTimes: ['20:00'],
      availability: 'limited',
    },
    duration: { fixedDurationInMinutes: 150 },
    keyAttributes: { features: ['Eight guests max', 'Dinner included'], mainCategory: 'Cooking Classes' },
  },
  {
    title: 'Petiscos and Natural Wine at a Chef’s Counter',
    code: 'MOCK-LISBON-PETISCOS',
    searchText: 'lisbon portugal principe real petiscos food tasting wine chef counter solo quiet no crowds evening tonight indoor late',
    thumbnail: 'https://images.example.invalid/roadio/lisbon-petiscos.jpg',
    rating: 4.7,
    reviewCount: 118,
    freeCancellation: false,
    fromPrice: 59,
    clickOffToLander: 'https://viator.example.invalid/mock/lisbon-petiscos',
    contactPhone: '+12125550108',
    contactPhoneIsMock: true,
    recommendationContext: {
      why: 'Counter seating works well solo, stays calm after dinner, and serves late.',
      neighborhood: 'Príncipe Real',
      walkingMinutes: 17,
      crowdLevel: 'quiet',
      availableStartTimes: ['20:30', '22:00'],
      availability: 'available',
    },
    duration: { fixedDurationInMinutes: 120 },
    keyAttributes: { features: ['Counter seating', 'Wine included'], mainCategory: 'Food Experiences' },
  },
  {
    title: 'Sunset Kayak beneath the Manhattan Skyline',
    code: 'MOCK-NYC-KAYAK',
    searchText: 'new york city nyc manhattan brooklyn kayak sunset water outdoor active skyline',
    thumbnail: 'https://images.example.invalid/roadio/nyc-kayak.jpg',
    rating: 4.6,
    reviewCount: 188,
    freeCancellation: true,
    fromPrice: 49,
    clickOffToLander: 'https://viator.example.invalid/mock/nyc-kayak',
    contactPhone: '+12125550106',
    contactPhoneIsMock: true,
    duration: { fixedDurationInMinutes: 120 },
    keyAttributes: { features: ['Equipment included'], mainCategory: 'Kayaking Tours' },
  },
]

function words(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+/g) ?? []
}

/** Local equivalent of the MCP search, enabled by ROADIO_VIATOR_MOCK=true. */
export function searchMockExperiences(
  userId: string,
  input: ExperienceSearchInput,
): ExperienceSearchResult {
  const queryWords = [...new Set(words(input.searchTerm))]
  const requestedDestinations = queryWords.filter((word) => DESTINATION_WORDS.has(word))
  const ranked = MOCK_VIATOR_EXPERIENCES
    .map((experience, catalogIndex) => {
      const haystack = new Set(words(`${experience.title} ${experience.searchText}`))
      const score = queryWords.reduce((total, word) => total + (haystack.has(word) ? 1 : 0), 0)
      return { experience, score, catalogIndex }
    })
    .filter(({ experience, score }) => {
      if (queryWords.length > 0 && score === 0) return false
      if (
        requestedDestinations.length > 0 &&
        !requestedDestinations.some((word) => words(experience.searchText).includes(word))
      ) return false
      if (input.fromPrice !== undefined && (experience.fromPrice ?? 0) < input.fromPrice) return false
      if (input.toPrice !== undefined && (experience.fromPrice ?? Infinity) > input.toPrice) return false
      if (input.duration !== undefined) {
        const duration = experience.duration
        const upper = duration?.fixedDurationInMinutes ?? duration?.variableDurationToMinutes
        if (upper !== undefined && upper > input.duration) return false
      }
      return true
    })
    .sort((a, b) => b.score - a.score || a.catalogIndex - b.catalogIndex)
    .slice(0, Math.min(10, Math.max(1, input.limit ?? 3)))
    .map(({ experience: { searchText: _searchText, ...experience } }) => experience)

  return { sessionId: viatorSessionId(userId), experiences: ranked }
}
