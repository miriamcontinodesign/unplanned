# Canonical Demo User Story

This is the one-minute founder-judge demo arc for Roadio. Product and demo decisions should support this story unless a newer brief explicitly replaces it.

## Maya’s evening in Lisbon

### 0:00–0:10 — The setup

“This is Maya. She just landed in Lisbon, has one free evening, and zero plans.”

Open the app: one warm prompt, no forms.

### 0:10–0:25 — The ask

Maya types one messy sentence:

> in Lisbon till Sunday, want something for tonight, love food, hate crowds.

The app replies conversationally and may ask one quick, high-value question with a chip:

> Solo or with someone?

She taps **Solo**.

### 0:25–0:40 — The magic

Three recommendation cards slide in. Each has a one-line, contextual reason, for example:

> Quiet natas spot, 8-min walk, open late.

This is the hero beat: the recommendations feel tailored, reasoned, and instant. Maya taps one.

### 0:40–0:50 — Close the loop

The app confirms:

> Booked ✓ — added to your evening.

Then it keeps momentum:

> Want a bar after?

The itinerary begins building itself rather than returning Maya to an empty state.

### 0:50–1:00 — The payoff

Cut to **Trips**. Tonight’s plan is laid out and the contextual nudge banner is visible.

> From lost to a full evening — in under a minute.

End.

## What the demo must prove

The narrative follows **need → magic → proof it’s real**:

1. **Need:** Maya has little time, no plan, and does not want to fill out a form.
2. **Magic:** Roadio turns messy intent and durable preferences into a small set of explainable, practical choices.
3. **Proof:** A choice becomes a booking and itinerary item, then Roadio proactively helps with the next useful decision.

## Product constraints implied by the story

- Accept natural, incomplete trip requests in one message.
- Extract destination, departure timing, immediate intent, likes, and dislikes.
- Ask at most one clarification when it materially changes the recommendations.
- Return three strong choices rather than a long search-results list.
- Explain each choice using concrete context such as atmosphere, distance, hours, weather, or availability.
- Make choosing and booking feel like one continuous action.
- Persist the selection into the trip itinerary immediately.
- Suggest a logical next step without derailing the current task.
- Show proactive nudges as contextual help, not generic notifications.
- Keep the full happy-path demo under one minute.

## Viator component contract for this demo

- Search returns three options by default.
- Mock mode contains three Lisbon evening food experiences tailored to a solo traveler avoiding crowds.
- Each mock result carries a one-line reason, neighborhood, walking time, crowd level, evening start times, availability state, price, rating, image, and operator contact.
- Live Viator results expose only fields returned by Viator. Roadio must never fabricate availability, walking time, crowd level, or booking confirmation when those facts have not been verified.
